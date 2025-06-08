---
title: 6.5840 実験一 —— MapReduce
tags: ["mapreduce","6.5840","6.824"]
lang: ja
published: 2022-01-20T22:29:00+08:00
abbrlink: notes/65840/mapreducelab
description: "実験一の目標は MapReduce システムを実装することで、master と worker の二つの主要な部分に分かれています。この過程は golang の RPC と並行プログラミングの理解が求められ、同時に MapReduce のフローを深く理解する必要があります。実験では mutex ロックを使ったバージョンから、より洗練された channel ベースのロックフリー版まで二つの実装を経験しました。後者の設計はより簡潔で明快です。実験の要点は関連ドキュメント、特にフローチャートと説明を丁寧に読むことにあります。"
---
### はじめに

実験一は MapReduce システムの実装が課題で、基本的には master プログラムと worker プログラムの二つの部分から成り立っています。この実験はかなり難易度が高く、まず golang の RPC と並行処理の使い方に慣れている必要があり、さらに MapReduce の全体的な流れと仕組みをよく理解していることが求められます。実は小さなコツがあり、それは論文中のこの図をひたすら眺め、下のフロー説明を繰り返し読むことです：

![mapReduce 実行フロー](https://blog-img.shinya.click/2025/6f7e7839e6f09e0d8193d530920a6f7e.jpg)

この実験では二つのバージョンを実装しました。主に並行制御の方法が異なります。最初は mutex ロックベースのバージョンで、後に channel を使ったロックフリーのバージョンにリファクタリングしました。ロックフリー版の実装はよりエレガントなので、説明も主にこちらを基にしています。

### 実験の説明

実験を始める前に、まずは実験内容を理解する必要があります。説明書はこちらです：[https://pdos.csail.mit.edu/6.824/labs/lab-mr.html](https://pdos.csail.mit.edu/6.824/labs/lab-mr.html)。この実験は Linux 環境で行う必要があります。なぜならプロセス間通信は unix socket を使っているためです。MacOS でも原理的には可能ですが、いくつか小さな問題があると言われています。

コードにはすでに単一スレッドの直列版 MapReduce が用意されており、`src/main/mrsequential.go` にあります。このバージョンは非常に重要で、まず一度読んで全体の流れを大まかに把握することをお勧めします。いくつかの処理はここからそのままコピーしても問題ありません。

並行版の master プログラムのエントリポイントは `main/mrcoordinator.go`、worker プログラムのエントリポイントは `main/mrworker.go` にあります。実装すべきファイルは三つで、`mr/coordinator.go`、`mr/worker.go`、`mr/rpc.go` です。これらはそれぞれ master の処理コード、worker の処理コード、そして両者間の通信に使う RPC 構造を表しています。

mrcoordinator は `mr/coordinator.go` 内の MakeCoordinator 関数を呼び出して master の構造体を構築し、ソケットのリスニングを開始します。戻った後、メインゴルーチンは繰り返し Coordinator.Done メソッドを呼び出し、MapReduce タスクが完了したかをチェックし、完了を確認してからメインゴルーチンを終了します。したがって、MakeCoordinator 内で関数の戻りを妨げる操作は避けるべきで、リスニングなどの処理は新しいゴルーチンで行う必要があります。

mrworker の処理は非常にシンプルで、メインゴルーチン一つだけで `mr/worker.go` の Worker 関数を直接呼び出して処理します。基本的には単一ゴルーチンのプログラムとして実装できます。

テストスクリプトは `src/main/test-mr.sh` にあり、これは既存の二つの MapReduce プログラム、wc と indexer をあなたのフレームワークで実行し、直列実行の結果と比較します。また、同じ Map または Reduce タスクを並行で実行した場合や、worker がタスク実行中にクラッシュした場合でも、最終的に正しい結果が得られるかを検証します。通常は master プロセス一つと worker プロセス三つを起動します。実行中にエラーが発生して終了しない場合は、`ps -A` コマンドで mrcoordinator プロセスの PID を探し、kill で終了させてください。普通の `ctrl + c` では完全に終了しないことがあり、後続のテストに影響を与えます。

最後に、実験指導書を何度も読み返すことを強くお勧めします。

### 実装の考え方

#### 全体の流れ

worker はまず map タスクを完了し、多数の中間ファイル "mr-X-Y" を生成します。ここで X は map タスクの ID、Y は対応する reduce タスクの ID です。次に reduce は Y が自身の reduce タスク ID と等しいすべてのファイルを集め、読み込んで reduce 処理を行い、結果を "mr-out-Y" に出力します。

#### master の実装

##### ロックフリーの考え方

ロックフリー実装のため、複数ゴルーチン間のデータ競合を避けるために、主要なデータ構造への操作は一つのゴルーチンに集約します。これをスケジューラゴルーチンと呼びます。worker が RPC で master にタスク取得や完了報告を要求すると、master は自動生成された RPC ゴルーチンでリクエストを処理しますが、主要データ構造への操作はすべてスケジューラゴルーチンに channel 経由で依頼します。これによりデータ競合を防ぎます。worker と master 間のメッセージは複数種類あるため、スケジューラは複数の channel を同時に管理する必要があり、golang の select 構文が活用されます。

```go
// この goroutine のみで構造体を操作
func (c *Coordinator) schedule() {
    for {
        select {
        case msg := <-c.getTaskChan:
            c.getTaskHandler(msg)
        case msg := <-c.doneTaskChan:
            c.doneTaskHandler(msg)
        case msg := <-c.timeoutChan:
            c.timeoutHandler(msg)
        case msg := <-c.doneCheckChan:
            c.doneCheckHandler(msg)
        }
    }
}
```

例えば worker がタスクを取得したい場合、master の GetTask は以下のように処理します：

```go
func (c *Coordinator) GetTask(_ *GetTaskReq, resp *GetTaskResp) error {
    msg := GetTaskMsg{
        resp: resp,
        ok:   make(chan struct{}),
    }
    c.getTaskChan <- msg
    <-msg.ok
    return nil
}
```

getTaskChan に送るのは resp（GetTask はリクエストパラメータなし）だけでなく、chan struct{} 型のチャネルも渡します。これはスケジューラゴルーチンが処理完了を RPC ゴルーチンに通知するためのもので、処理完了時に msg.ok に struct{} を送ることで RPC ゴルーチンが戻ります。

##### Coordinator の構造体

Coordinator の全体構造は以下の通りです：

```go
type Coordinator struct {
    nMap    int
    nReduce int
    phase   TaskPhase
    allDone bool
 
    taskTimeOut map[int]time.Time
    tasks       []*Task
 
    getTaskChan   chan GetTaskMsg
    doneTaskChan  chan DoneTaskMsg
    doneCheckChan chan DoneCheckMsg
    timeoutChan   chan TimeoutMsg
}
```

phase は現在のタスク実行フェーズを示します。reduce タスクはすべての map タスク完了後に実行されるため、TaskPhase は Map と Reduce の二段階に分かれています。各フェーズで tasks スライスには該当フェーズのタスクのみが入ります。

taskTimeOut は現在実行中のタスクの開始時刻を記録し、別ゴルーチンが定期的にこの map をスキャンして、10秒以上経過したタスク（タイムアウト）を検出し、該当タスクの状態を未開始に戻して再スケジューリング可能にします。このスキャンもスケジューラゴルーチン経由で行います。タイムアウト map には現在のフェーズのタスクのみが含まれ、フェーズ切り替え時にクリアされます。

tasks スライスは現在フェーズのすべての Task とその状態を保持します：

```go
type ReduceTask struct {
    NMap int
}
 
type MapTask struct {
    FileName string
    NReduce  int
}
 
type TaskStatus int
 
var (
    TaskStatus_Idle     TaskStatus = 0
    TaskStatus_Running  TaskStatus = 1
    TaskStatus_Finished TaskStatus = 2
)
 
type Task struct {
    TaskId     int
    MapTask    MapTask
    ReduceTask ReduceTask
    TaskStatus TaskStatus
}
```

ここではタスク状態を三つに分類しています：未実行、実行中、完了済み。また MapTask と ReduceTask の両方を冗長に保持し、現在のフェーズに応じて使い分けます。

##### 具体的な処理

Coordinator の channel からわかるように、四種類の操作がスケジューラゴルーチンと通信されます。

worker がタスクを要求すると、返されるタスクタイプは四種類あります：

```go
type TaskType int
 
var (
    TaskType_Map    TaskType = 0
    TaskType_Reduce TaskType = 1
    TaskType_Wait   TaskType = 2
    TaskType_Exit   TaskType = 3
)
```

master はまず tasks を走査し、未実行のタスクを探し、現在のフェーズに応じて Map または Reduce タスクを返します。空きタスクがない場合は二つの状況に分かれます。Map フェーズなら TaskType_Wait を返して worker に待機を促し、Map フェーズ終了後に Reduce タスクが続きます。Reduce フェーズならすべてのタスクが完了しているため、TaskType_Exit を返して worker に終了を指示します。

worker がタスク完了を報告すると、master はタスクタイプと ID を受け取ります。master は現在のフェーズと異なるタスクは無視し、taskId に該当する tasks の状態を強制的に完了に変更し、timeout マップから該当エントリを削除します。

```go
func (c *Coordinator) doneTaskHandler(msg DoneTaskMsg) {
    req := msg.req
    if req.TaskType == TaskType_Map && c.phase == TaskPhase_Reduce {
        // 現フェーズと異なるタスクの報告は無視
        msg.ok <- struct{}{}
        return
    }
    for _, task := range c.tasks {
        if task.TaskId == req.TaskId {
            // 状態に関わらず完了に変更
            task.TaskStatus = TaskStatus_Finished
            break
        }
    }
    // timeout マップから削除
    delete(c.taskTimeOut, req.TaskId)
    allDone := true
    for _, task := range c.tasks {
        if task.TaskStatus != TaskStatus_Finished {
            allDone = false
            break
        }
    }
    if allDone {
        if c.phase == TaskPhase_Map {
            c.initReducePhase()
        } else {
            c.allDone = true
        }
    }
    msg.ok <- struct{}{}
}
```

Reduce フェーズで全タスク完了を検出した場合は allDone フラグを立てます。

Coordinator 初期化時に別ゴルーチンを起動し、1秒ごとにスケジューラにタイムアウトチェックを依頼します。タイムアウトしたタスクは状態を未開始に戻し、次回の worker タスク要求時に再スケジューリングされます。

```go
func (c *Coordinator) timeoutHandler(msg TimeoutMsg) {
    now := time.Now()
    for taskId, start := range c.taskTimeOut {
        if now.Sub(start).Seconds() > 10 {
            for _, task := range c.tasks {
                if taskId == task.TaskId {
                    if task.TaskStatus != TaskStatus_Finished {
                        task.TaskStatus = TaskStatus_Idle
                    }
                    break
                }
            }
            delete(c.taskTimeOut, taskId)
            break
        }
    }
    msg.ok <- struct{}{}
    return
}
```

最後に、完了状態のチェックはメインスレッドが Coordinator.Done を呼び、スケジューラに allDone フラグを確認するだけです。

#### worker の実装

worker は単一ゴルーチンで master からタスクを取得し、ループで実行します：

```go
func Worker(mapf func(string, string) []KeyValue,
    reducef func(string, []string) string) {
    for {
        resp := callGetTask()
        switch resp.TaskType {
        case TaskType_Map:
            handleMapTask(resp.Task, mapf)
        case TaskType_Reduce:
            handleReduceTask(resp.Task, reducef)
        case TaskType_Wait:
            time.Sleep(time.Second)
        case TaskType_Exit:
            return
        }
    }
}
```

map と reduce の処理は直列単一スレッド版の実装を参考にできます。注意点として、複数プロセスが同一タスクを同時に実行したり、途中でクラッシュした場合に残されたファイルが再実行時に問題を引き起こすことがあります。したがって出力ファイルは、`ioutil.TempFile` 関数で一時ファイルを作成し、書き込み完了後に `os.Rename` で目的のファイル名にリネームする方法を用いると、最終出力ファイルが必ず完全な状態で保存されることが保証されます。