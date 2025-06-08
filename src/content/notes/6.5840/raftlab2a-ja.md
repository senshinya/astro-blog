---
title: 6.5840 実験 2a —— リーダー選出
tags: ["raft","6.5840","6.824"]
lang: ja
published: 2022-12-16T02:06:10+08:00
abbrlink: notes/65840/raftlab2a
description: "実験 2a は Raft アルゴリズムにおけるリーダー選出とハートビート機構の実装に焦点を当てており、さまざまな極端な状況下でも正常にリーダー交代と選挙が行われることを保証することを目的としています。この実験は後続の分散KVストレージ実装の基礎となり、4つのステップに分かれており、ロックフリー版の設計により Raft 構造体の複雑さを軽減しています。実験マニュアルは必要な背景資料を提供しますが、前回の実験に比べてほとんど参考資料に依存せず、独立して実装する重要性を強調しています。"
---
### はじめに

6.824 の実験2は Raft アルゴリズムの実装です。後続の実験で実装する分散KVストレージは、本実験で実装した Raft アルゴリズムを分散合意モジュールとして使用するため、実験2は後続実験にとって非常に重要です。

実験2は Raft アルゴリズムを4つのステップに分け、それぞれをサブ実験として実装します。実験 2a は基本的なリーダー選出とハートビートのみを実装し、さまざまな極端な（切断など）状況下でも正常にリーダー交代と選挙が行われることを保証します。

もちろん、2a は4つのサブ実験の基礎を築く最初の実験として、リーダー選出機能の実装だけでなく、全体の処理フレームワークの構築も必要です。同様に、私はロックフリー版を実装しており、Raft 構造体内の mu 変数は削除可能になりました（狂気の沙汰）。

### 実験の説明

実験マニュアルは [https://pdos.csail.mit.edu/6.824/labs/lab-raft.html](https://pdos.csail.mit.edu/6.824/labs/lab-raft.html) にあります。実験1とは異なり、今回はほとんど参考資料がありません。実装すべきコードは `src/raft/raft.go` にあり、この Raft 構造体は非常に基本的な構造体です：

```go
type Raft struct {
    peers []*labrpc.ClientEnd // 全ピアのRPCエンドポイント
    persister *Persister // このピアの永続状態を保持するオブジェクト
    me int // このピアの peers[] におけるインデックス
    dead int32 // Kill() によって設定される
}
```

各 Raft 構造体はクラスター内の1つのサーバーを表し、Raft 構造体はそのサーバーが必要とするすべての情報を保持します。

peers は現在の構成クラスター内のすべてのサーバーで、ClientEnd 構造体は Call を使って直接RPCリクエストを送信できます。me は現在のマシンのクラスター内での一意の識別子で、他のマシンでもこのインデックスで認識されます。

lab2a における Raft のエントリーポイントは `Make()` メソッドで、Make メソッドで構造体を初期化した後、`rf.ticker()` というゴルーチンを起動します。このゴルーチンは無限ループ（終了フラグに基づくループですが、マシンのシャットダウン後は考慮しないため無限ループとみなせます）を実行し、このメソッドがメインルーチンとみなせます。

実験2の最も難しい点は、フレームワークがほとんど実装を提供しておらず、ほぼゼロから Raft アルゴリズム全体を実装する必要があることです。幸いにも、論文中の Figure 2 が全体の実装方針をほぼ示しています。

また、テストケースは同じフォルダの `test_test.go` に実装されており、テストが通らない場合はテストケースの実装を確認し、テストシナリオに基づいてデバッグしてください。

lab 2d のテストコマンドは `go test -run 2A` で、データ競合を検出するために `go test -race -run 2A` の使用を推奨します。

### 実験の考え方

#### 全体の流れ

ロックフリー版を実装するため、まずは全体の処理フローとゴルーチン間通信を慎重に設計し、良好な基盤を築くことが重要です。これは後続の実験にも大きな助けとなります。何せ一連の実験の最初のものですから。

まず、メインゴルーチンは `rf.ticker()` メソッドとし、このメソッドだけが Raft 構造体のフィールドを変更できると約束します。他のゴルーチンは変更を許されません。これによりデータ競合を直接回避でき、`ticker()` メソッドは無限ループで複数のチャネルからのメッセージを監視します。

では、具体的にどのようなゴルーチン間通信が必要で、どんなチャネルが必要でしょうか？まず選挙には2種類のRPCリクエストがあります：AppendEntries（追加要求）とRequestVote（投票依頼）。サーバーがこれらのリクエストの受信側になる場合、メインゴルーチンで直接受け取るわけではないため、これらのRPCリクエストはメインゴルーチンに送る必要があり、2つのチャネルが必要です。次に、サーバーが送信側の場合、RPCの送信は非メインゴルーチンで行われ（メインゴルーチンがRPCの応答待ちをしないため）、これらのRPCの応答を受け取ったらメインゴルーチンに処理を委ねるため、さらに2つのチャネルが必要です。

これ以外に、2つのタイマーが必要です。1つは選挙タイムアウト用、もう1つはハートビートタイムアウト用です。実験マニュアルでは `time.Sleep()` を使い一定時間スリープする方法を推奨していますが、この方法はタイムアウトの中断ができません。したがって、マニュアルでは `time.Timer` は推奨されていませんが、私はタイムアウトの中断とリセットを実現するために敢えて Timer を使いました。ただし、Timer の正しい使い方はなかなか難しいです。

まずサーバーの状態を表す型を定義し、サーバーの身分を示します：

```go
type ServerStatus uint8
 
const (
    Follower  ServerStatus = 0
    Candidate ServerStatus = 1
    Leader    ServerStatus = 2
)
```

Raft 論文の Figure 2 に対応して、サーバーの基本フィールドと前述のチャネルやタイマーを定義します：

```go
type Raft struct {
    ...

    // 状態
    Status ServerStatus
    // コミット済みログを外部に渡すチャネル
    ApplyCh chan ApplyMsg

    /***** 全サーバーが持つ永続状態 *****/
    // CurrentTerm 現在の最大任期。起動時は0で単調増加
    CurrentTerm int
    // VotedFor 現任期で投票した候補者ID。未投票は -1
    VotedFor int
    // Logs ログエントリ。各エントリは状態機械のコマンドとリーダーが受け取った任期を含む。インデックスは1始まり
    Logs []*LogEntry

    /***** 全サーバーが持つ可変状態 *****/
    // CommitIndex 既知の最大のコミット予定ログインデックス。起動時は0で単調増加
    CommitIndex uint64
    // LastApplied 最大の適用済みログインデックス。起動時は0で単調増加
    LastApplied uint64

    /******* リーダーが持つ可変状態。選挙後に初期化 *******/
    // NextIndex 各サーバーに次に送信するログエントリのインデックス。リーダーの最後のログインデックス+1で初期化
    NextIndex []uint64
    // MatchIndex 各サーバーが複製済みの最高ログエントリ。0で初期化し単調増加
    MatchIndex []uint64

    // タイマー
    electionTimer  *time.Timer
    heartbeatTimer *time.Timer

    // RPCリクエスト処理用チャネル
    requestVoteChan   chan RequestVoteMsg
    appendEntriesChan chan AppendEntriesMsg
}
```

使用するチャネルやタイマーはすべて `Make()` 関数内で初期化する必要があります。そうしないと nil チャネルがすべての読み書きをブロックします。また、関数の戻り前にメインゴルーチンとしてチャネルのメッセージを監視するゴルーチンを起動します：

```go
func (rf *Raft) ticker() {
    for !rf.killed() {
        select {
        case <-rf.electionTimer.C:
            rf.startElection()
            resetTimer(rf.electionTimer, RandomizedElectionTimeout())
        case <-rf.heartbeatTimer.C:
            rf.broadcastHeartbeat()
            resetTimer(rf.heartbeatTimer, FixedHeartbeatTimeout())
        case msg := <-rf.requestVoteChan:
            rf.handleRequestVote(msg)
        case msg := <-rf.appendEntriesChan:
            rf.handleAppendEntries(msg)
        case msg := <-rf.requestVoteResChan:
            rf.handleRequestVoteRes(msg)
        case msg := <-rf.appendEntriesResChan:
            rf.handleAppendEntriesRes(msg)
        }
    }
}
```

#### 2つのタイマー

electionTimer は選挙タイムアウト用のタイマーで、毎回ランダムな時間に初期化します。これは起動時にクラスター内のマシンが一斉に選挙タイムアウトになるのを防ぐためです。ランダム時間の範囲は 300 ～ 450 ms です。heartbeatTimer はハートビートタイムアウト用で、固定の100msに初期化します。

```go
func Make(peers []*labrpc.ClientEnd, me int,
    persister *Persister, applyCh chan ApplyMsg) *Raft {
    ...
    rf.electionTimer = time.NewTimer(RandomizedElectionTimeout())
    rf.heartbeatTimer = time.NewTimer(FixedHeartbeatTimeout())
    ...
}

func RandomizedElectionTimeout() time.Duration {
    rand.Seed(time.Now().UnixNano())
    return time.Duration(rand.Intn(150)+300) * time.Millisecond
}

func FixedHeartbeatTimeout() time.Duration {
    return time.Millisecond * 100
}
```

選挙タイムアウトタイマーは主にリーダー以外のサーバーに使われ、リーダーからのハートビートを受け取るたびにリセットされます。一定時間ハートビートが届かないとサーバーは選挙を開始します。選挙開始の流れは以下の通りです：

1. 現在の任期を+1
2. 身分を Candidate に変え、自分自身に投票
3. 全マシンに投票依頼を送信

実装例：

```go
func (rf *Raft) startElection() {
    if rf.Status == Leader {
        // リーダーは新たな選挙を開始しない
        return
    }
    rf.CurrentTerm += 1
    // fmt.Printf("server %d start election for term %d\n", rf.me, rf.CurrentTerm)
    rf.Status = Candidate
    rf.VotedFor = rf.me
    args := RequestVoteArgs{
        Term:         rf.CurrentTerm,
        CandidateId:  rf.me,
        LastLogIndex: len(rf.Logs) - 1,
    }
    if len(rf.Logs) != 0 {
        args.LastLogTerm = rf.Logs[len(rf.Logs)-1].Term
    }
    meta := ElectionMeta{
        term: rf.CurrentTerm,
        yeas: 1,
        nays: 0,
    }
    for peer := range rf.peers {
        if peer == rf.me {
            continue
        }
        go rf.sendRequestVoteRoutine(peer, args, &meta)
    }
}
```

ElectionMeta は今回の選挙のメタ情報を保持し、任期、賛成票数、反対票数を含みます。メインゴルーチンで全投票完了を待つことはできないため、クラスターの各マシンに対して投票RPCを管理するゴルーチンを起動します。これらのRPCは選挙結果を知った後、チャネルを通じてメインゴルーチンに通知します。選挙開始後は選挙タイムアウトタイマーをリセットします。

ハートビートタイムアウトタイマーは主にリーダー用で、自身のリーダー身份を維持するために使います。タイムアウトするたびにクラスターにハートビートをブロードキャストし、新たな選挙が起きないようにします。ブロードキャスト後はハートビートタイムアウトタイマーをリセットします。

```go
func (rf *Raft) broadcastHeartbeat() {
    if rf.Status != Leader {
        return
    }
    // fmt.Printf("server %d broadcast heartbeat\n", rf.me)
    args := AppendEntriesArgs{
        Term:     rf.CurrentTerm,
        LeaderID: rf.me,
    }
    for peer := range rf.peers {
        if peer == rf.me {
            continue
        }
        go rf.sendAppendEntriesRoutine(peer, args)
    }
}
```

ハートビートRPCは AppendEntries RPCを流用し、クラスター内の他マシンとのRPC接続はそれぞれ別ゴルーチンで処理します。

#### 投票関連

選挙タイムアウト後、リーダーでないマシンは新たな選挙を開始し、新リーダー選出を試みます。上記の `startElection()` では、各マシンに対して投票RPCを管理するゴルーチンを起動しています。投票依頼を送るゴルーチン関数は以下の通りです：

```go
// 投票依頼送信ゴルーチン
func (rf *Raft) sendRequestVoteRoutine(peer int, args RequestVoteArgs, electionMeta *ElectionMeta) {
    reply := RequestVoteReply{}
    ok := rf.sendRequestVote(peer, &args, &reply)
    if !ok {
        return
    }
    msg := RequestVoteResMsg{
        resp: &reply,
        meta: electionMeta,
    }
    rf.requestVoteResChan <- msg
}
```

特別な処理はなく、単にRPCを送信し、結果をラップしてチャネル経由でメインゴルーチンに送ります。RPCのリクエストとレスポンスの構造体は以下です：

```go
// 投票依頼RPCリクエスト
type RequestVoteArgs struct {
    // Term 候補者の任期
    Term int
    // CandidateId 投票依頼を送る候補者のID
    CandidateId int
    // LastLogIndex 候補者の最後のログエントリのインデックス
    LastLogIndex int
    // LastLogTerm 候補者の最後のログエントリの任期
    LastLogTerm int64
}

// 投票依頼RPCレスポンス
type RequestVoteReply struct {
    // Term 現在の任期
    Term int
    // VoteGranted trueなら投票成功
    VoteGranted bool
}

// 投票依頼RPC送信入口
func (rf *Raft) sendRequestVote(server int, args *RequestVoteArgs, reply *RequestVoteReply) bool {
    ok := rf.peers[server].Call("Raft.RequestVote", args, reply)
    return ok
}
```

受信側のRPC入口は RequestVote メソッドで、RPC受信ゴルーチンはメインゴルーチンではないため、投票依頼をチャネルでメインゴルーチンに渡します：

```go
/********* 投票依頼受信側関連メソッド *********/
// 投票依頼RPC受信入口
func (rf *Raft) RequestVote(args *RequestVoteArgs, reply *RequestVoteReply) {
    msg := RequestVoteMsg{
        req: args,
        ok:  make(chan RequestVoteReply),
    }
    rf.requestVoteChan <- msg
    resp := <-msg.ok
    *reply = resp
}

// メインゴルーチンで投票依頼を処理
func (rf *Raft) handleRequestVote(msg RequestVoteMsg) {
    req := msg.req
    if req.Term < rf.CurrentTerm ||
        (req.Term == rf.CurrentTerm && rf.VotedFor != -1 && rf.VotedFor != req.CandidateId) {
        msg.ok <- RequestVoteReply{
            Term:        rf.CurrentTerm,
            VoteGranted: false,
        }
        return
    }
    rf.rpcTermCheck(req.Term)
    rf.VotedFor = req.CandidateId
    resetTimer(rf.electionTimer, RandomizedElectionTimeout())
    // fmt.Printf("server %d vote for server %d for term %d\n", rf.me, msg.req.CandidateId, req.Term)
    msg.ok <- RequestVoteReply{
        Term:        rf.CurrentTerm,
        VoteGranted: true,
    }
}
```

サーバーが賛成票を投じた場合は選挙タイムアウトタイマーをリセットします。`rpcTermCheck()` はRPCリクエストやレスポンス内の任期が自身の任期より大きいかをチェックし、大きければ自身の任期を更新し Follower に戻す共通関数です：

```go
// RPCリクエストやレスポンスの任期をチェックし、自身の任期より大きければ更新しFollowerに戻す
func (rf *Raft) rpcTermCheck(msgTerm int) {
    if rf.CurrentTerm < msgTerm {
        rf.CurrentTerm = msgTerm
        rf.Status = Follower
        rf.VotedFor = -1
    }
}
```

投票依頼送信ゴルーチンは返答を受け取ったら結果をメインゴルーチンに送信し、メインゴルーチンで得票数の集計や判断を行います。メインゴルーチンでの投票結果処理は以下の通りです：

```go
// メインゴルーチンで投票依頼の返答を処理
func (rf *Raft) handleRequestVoteRes(msg RequestVoteResMsg) {
    meta := msg.meta
    if rf.Status != Candidate {
        return
    }
    if rf.CurrentTerm != meta.term {
        return
    }
    if msg.resp.VoteGranted {
        meta.yeas++
        if meta.yeas > len(rf.peers)/2 {
            // fmt.Printf("server %d become leader for term %d\n", rf.me, rf.CurrentTerm)
            rf.Status = Leader
            resetTimer(rf.heartbeatTimer, FixedHeartbeatTimeout())
            rf.broadcastHeartbeat()
        }
    } else {
        meta.nays++
        rf.rpcTermCheck(msg.resp.Term)
        if meta.nays > len(rf.peers)/2 {
            // 反対票が過半数を超えた場合、その任期の選挙は失敗。ほかの候補者に投票可能
            rf.VotedFor = -1
        }
    }
}
```

まず2つのチェックを行います。現在のサーバーの状態が Candidate でない場合、またはサーバーの任期と投票の任期が異なる場合は期限切れの投票であり処理不要なので戻ります。

賛成票の場合は賛成票数が過半数を超えたかを確認し、超えていれば選挙成功とみなし、発起サーバーは Leader に変わり、ハートビートタイマーをリセットし、全マシンにハートビートをブロードキャストしてリーダー身份を宣言します。

反対票の場合は小さな最適化として、反対票が過半数を超えたらその選挙は失敗とみなし、その任期内の投票を -1 に戻して他の候補者への投票を促進します。

#### 追加関連

追加関連は今回の実験ではハートビート処理のみ実装します。より詳細なログ追加は実験 2b で行います。

`broadcastHeartbeat()` 関数ではクラスター内の全マシンにハートビートをブロードキャストし、これは AppendEntries RPCを使います。各マシンとの通信はそれぞれゴルーチンで管理します。追加送信ゴルーチンは以下の通りです：

```go
// 追加要求送信ゴルーチン
func (rf *Raft) sendAppendEntriesRoutine(peer int, args AppendEntriesArgs) {
    reply := AppendEntriesReply{}
    ok := rf.sendAppendEntries(peer, &args, &reply)
    if !ok {
        return
    }
    rf.appendEntriesResChan <- AppendEntriesResMsg{
        resp: &reply,
    }
}
```

投票と同様に、単にRPCを送信し応答を受け取り、チャネル経由でメインゴルーチンに渡します。追加RPCのリクエストとレスポンスは以下です：

```go
// 追加RPCリクエスト
type AppendEntriesArgs struct {
    // Term リーダーの任期
    Term int
    // LeaderID Followerはクライアントリクエストをリーダーにリダイレクト可能
    LeaderID int
    // PrevLogIndex 新しいログエントリの直前のログインデックス
    PrevLogIndex int
    // PrevLogTerm 直前のログエントリの任期
    PrevLogTerm int
    // Entries 保存すべきログエントリ。ハートビートは空
    Entries []*LogEntry
    // LeaderCommit リーダーの CommitIndex
    LeaderCommit int
}

// 追加RPCレスポンス
type AppendEntriesReply struct {
    // Term Followerの現在任期
    Term int
    // Success PrevLogIndex と PrevLogTerm が一致すれば true
    Success bool
}

// 追加要求RPC送信入口
func (rf *Raft) sendAppendEntries(server int, args *AppendEntriesArgs, reply *AppendEntriesReply) bool {
    ok := rf.peers[server].Call("Raft.AppendEntries", args, reply)
    return ok
}
```

受信側は追加RPCを受け取ったらメインゴルーチンに処理を委ねます。今回のメインゴルーチンの処理はハートビートシナリオのみで、Followerに戻し選挙タイムアウトタイマーをリセットし、任期更新が必要なら行います：

```go
/********* 追加要求受信側関連メソッド *********/
// 追加要求RPC受信入口
func (rf *Raft) AppendEntries(args *AppendEntriesArgs, reply *AppendEntriesReply) {
    msg := AppendEntriesMsg{
        req: args,
        ok:  make(chan AppendEntriesReply),
    }
    rf.appendEntriesChan <- msg
    resp := <-msg.ok
    *reply = resp
}

// メインゴルーチンで追加要求を処理
func (rf *Raft) handleAppendEntries(msg AppendEntriesMsg) {
    rf.Status = Follower
    resetTimer(rf.electionTimer, RandomizedElectionTimeout())
    rf.rpcTermCheck(msg.req.Term)
    msg.ok <- AppendEntriesReply{
        Term: rf.CurrentTerm,
    }
}
```

最後に送信側は応答を受け取ったら任期をチェックするだけでよく、`rpcTermCheck()` を再利用します：

```go
// メインゴルーチンで追加要求の返答を処理
func (rf *Raft) handleAppendEntriesRes(msg AppendEntriesResMsg) {
    resp := msg.resp
    rf.rpcTermCheck(resp.Term)
}
```