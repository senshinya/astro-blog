---
title: MYDB 6. レコードのバージョンとトランザクションの分離レベル
lang: ja
published: 2021-12-18T14:58:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb6
description: "VMは2フェーズロックプロトコルによりスケジューリングシーケンスの直列化可能性を保証し、読み書きのブロック問題を解消するために多版本並行制御（MVCC）を導入しています。また、データベース操作における競合を定義し、特に更新操作と読み取り操作の相互影響に注目し、トランザクション間の分離レベルの理解の基礎を築いています。"
---

本章で扱うコードはすべて [backend/vm](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/vm) にあります。

### はじめに

この章から、Version Manager（VM）について議論を始めます。

> VM は 2 フェーズロックプロトコル（2PL）に基づきスケジューリングシーケンスの直列化可能性を実現し、さらに MVCC を導入して読み書きのブロックを解消しています。同時に、2 種類の分離レベルも実装しています。

Data Manager（DM）が MYDB のデータ管理の中核であるのに対し、Version Manager は MYDB のトランザクションとデータバージョン管理の中核です。

### 2PL と MVCC

#### 競合と 2PL

まず、データベースにおける競合を定義します。挿入操作は一旦考慮せず、更新操作（U）と読み取り操作（R）のみを見ます。以下の 3 つの条件を満たす 2 つの操作は互いに競合すると言えます：

1.  それぞれ異なるトランザクションによって実行されている
2.  同じデータ項目を操作している
3.  少なくとも一方が更新操作である

つまり、同じデータに対する競合は以下の 2 パターンに限られます：

1.  異なるトランザクションによる更新操作同士の競合
2.  異なるトランザクションによる更新操作と読み取り操作の競合

では、競合か否かの意味は何でしょうか？それは、**競合しない操作同士の順序を入れ替えても最終結果に影響を与えない**のに対し、競合する操作の順序を入れ替えると結果に影響が出る、という点にあります。

ここで競合を一旦脇に置き、4 章で挙げた例を思い出してください。並行実行時に 2 つのトランザクションが同時に x を操作します。x の初期値は 0 とします：

```
T1 begin
T2 begin
R1(x) // T1 は 0 を読み取る
R2(x) // T2 も 0 を読み取る
U1(0+1) // T1 は x を +1 しようとする
U2(0+1) // T2 も x を +1 しようとする
T1 commit
T2 commit
```

最終的に x の値は 1 となり、期待される結果とは異なります。

VM の重要な役割の一つは、スケジューリングシーケンスの直列化可能性を実現することです。MYDB は 2PL を用いてこれを実現しています。2PL を採用すると、もしあるトランザクション i が x にロックをかけている場合、別のトランザクション j が x を操作しようとしてその操作が i の操作と競合するなら、j はブロックされます。例えば、T1 が U1(x) で x にロックをかけているなら、T2 の x に対する読み書き操作はすべてブロックされ、T1 がロックを解放するまで待つ必要があります。

このように、2PL はスケジューリングシーケンスの直列化可能性を保証しますが、トランザクション間の相互ブロックを避けられず、デッドロックを引き起こす可能性もあります。MYDB はトランザクション処理の効率を高め、ブロックの確率を下げるために MVCC を実装しています。

#### MVCC

MVCC を説明する前に、レコードとバージョンの概念を明確にします。

DM 層は上位にデータ項目（Data Item）の概念を提供し、VM はすべてのデータ項目を管理することで上位にレコード（Entry）の概念を提供します。上位モジュールが VM を通じて操作する最小単位はレコードです。VM は内部で各レコードに対して複数のバージョン（Version）を管理します。上位モジュールがあるレコードを更新するたびに、VM はそのレコードの新しいバージョンを作成します。

MYDB は MVCC によりトランザクションのブロック確率を下げています。例えば、T1 がレコード X を更新したい場合、まず X のロックを取得し、新しいバージョン x3 を作成します。もし T1 がまだロックを解放していない間に T2 が X を読みたい場合、ブロックされずに古いバージョン x2 を返します。これにより、最終的な実行結果は T2 が先に実行され、T1 が後に実行されたのと同等になり、スケジューリングシーケンスの直列化可能性が保たれます。ただし、X に古いバージョンが存在しない場合は T1 のロック解放を待つ必要があるため、確率的にブロックが減るだけです。

4 章でデータの回復性を保証するために、VM 層から DM に渡す操作シーケンスは以下の 2 つのルールを満たす必要があると述べました：

> ルール 1：進行中のトランザクションは、他の未コミットのトランザクションが生成したデータを読み取らない。  
> ルール 2：進行中のトランザクションは、他の未コミットのトランザクションが変更または生成したデータを変更しない。

2PL と MVCC の組み合わせにより、これらの条件は容易に満たされます。

### レコードの実装

1 つのレコードに対し、MYDB は Entry クラスでその構造を管理しています。理論上は MVCC により多版本を実現していますが、実装上は VM は Update 操作を提供せず、フィールドの更新は後述のテーブル・フィールド管理（TBM）が担当するため、VM 内の 1 レコードは単一バージョンのみです。

レコードは 1 つの Data Item に格納されるため、Entry は DataItem への参照を保持します：

```java
public class Entry {
    private static final int OF_XMIN = 0;
    private static final int OF_XMAX = OF_XMIN+8;
    private static final int OF_DATA = OF_XMAX+8;

    private long uid;
    private DataItem dataItem;
    private VersionManager vm;

    public static Entry loadEntry(VersionManager vm, long uid) throws Exception {
        DataItem di = ((VersionManagerImpl)vm).dm.read(uid);
        return newEntry(vm, di, uid);
    }

    public void remove() {
        dataItem.release();
    }
}
```

Entry 内のデータフォーマットは以下のように規定しています：

```
[XMIN] [XMAX] [DATA]
```

XMIN はそのレコード（バージョン）を作成したトランザクション ID、XMAX は削除したトランザクション ID です。これらの役割は次節で説明します。DATA はレコードが保持するデータです。この構造に基づき、レコード作成時に呼ばれる `wrapEntryRaw()` メソッドは以下の通りです：

```java
public static byte[] wrapEntryRaw(long xid, byte[] data) {
    byte[] xmin = Parser.long2Byte(xid);
    byte[] xmax = new byte[8];
    return Bytes.concat(xmin, xmax, data);
}
```

同様に、レコード内のデータを取得するにはこの構造に従って解析します：

```java
// コピー形式で内容を返す
public byte[] data() {
    dataItem.rLock();
    try {
        SubArray sa = dataItem.data();
        byte[] data = new byte[sa.end - sa.start - OF_DATA];
        System.arraycopy(sa.raw, sa.start+OF_DATA, data, 0, data.length);
        return data;
    } finally {
        dataItem.rUnLock();
    }
}
```

ここではコピー形式でデータを返しています。もし変更が必要なら、DataItem の `before()` メソッドを実行する必要があります。これは XMAX の値設定時に示されています：

```java
public void setXmax(long xid) {
    dataItem.before();
    try {
        SubArray sa = dataItem.data();
        System.arraycopy(Parser.long2Byte(xid), 0, sa.raw, sa.start+OF_XMAX, 8);
    } finally {
        dataItem.after(xid);
    }
}
```

`before()` と `after()` は DataItem の節で既に定められたデータ項目の変更ルールです。

### トランザクションの分離レベル

#### 読み取りコミット（Read Committed）

前述の通り、もしレコードの最新バージョンがロックされている場合、別のトランザクションがそのレコードを変更または読み取りたいとき、MYDB は古いバージョンのデータを返します。これにより、最新のロックされたバージョンは他のトランザクションからは見えない、すなわちバージョンの可視性の概念が生まれます。

バージョンの可視性はトランザクションの分離度に関係します。MYDB がサポートする最低の分離レベルは「読み取りコミット（Read Committed）」であり、トランザクションは読み取り時にコミット済みのデータのみを参照できます。最低限の読み取りコミットを保証する利点は 4 章で述べた通り（カスケードロールバックとコミットセマンティクスの衝突防止）です。

MYDB は各バージョンに 2 つの変数を持たせて読み取りコミットを実現しています。すなわち、先述の XMIN と XMAX です：

- XMIN：そのバージョンを作成したトランザクション ID
- XMAX：そのバージョンを削除したトランザクション ID

XMIN はバージョン作成時に設定され、XMAX はバージョン削除時または新バージョン作成時に設定されます。

XMAX の存在は、DM 層が削除操作を提供しない理由も説明します。バージョンを削除したい場合は XMAX を設定すればよく、これによりそのバージョンは XMAX 以降のトランザクションから見えなくなり、実質的に削除と同義になります。

このように、読み取りコミットの下でのバージョンのトランザクションに対する可視性は以下の通りです：

```
(XMIN == Ti and                             // Ti によって作成され、
    XMAX == NULL                            // まだ削除されていない
)
or                                          // または
(XMIN がコミット済みであり、                  // コミット済みトランザクションによって作成され、
    (XMAX == NULL or                        // まだ削除されていないか、
    (XMAX != Ti and XMAX は未コミット))       // 未コミットのトランザクションによって削除された
)
```

条件が true なら、そのバージョンはトランザクション Ti に対して可視です。Ti に適したバージョンを取得するには、最新バージョンから順に可視性をチェックし、true なら即座に返せばよいです。

以下のメソッドは、あるレコードがトランザクション t に対して可視かどうかを判定します：

```java
private static boolean readCommitted(TransactionManager tm, Transaction t, Entry e) {
    long xid = t.xid;
    long xmin = e.getXmin();
    long xmax = e.getXmax();
    if(xmin == xid && xmax == 0) return true;

    if(tm.isCommitted(xmin)) {
        if(xmax == 0) return true;
        if(xmax != xid) {
            if(!tm.isCommitted(xmax)) {
                return true;
            }
        }
    }
    return false;
}
```

ここで Transaction 構造体は XID のみを提供しています。

#### リピータブルリード（Repeatable Read）

読み取りコミットが引き起こす問題はよく知られています。すなわち、不可再読（不可繰り返し読み取り）とファントムリードです。ここでは不可再読の問題を解決します。

不可再読とは、あるトランザクションが同じデータ項目を複数回読み取る際に異なる結果を得る現象です。例えば、X の初期値は 0 とします：

```
T1 begin
R1(X) // T1 は 0 を読み取る
T2 begin
U2(X) // X を 1 に更新
T2 commit
R1(X) // T1 は 1 を読み取る
```

T1 は 2 回の読み取りで異なる値を得ています。これを防ぐには、より厳密な分離レベルであるリピータブルリード（Repeatable Read）を導入します。

T1 が 2 回目の読み取りで T2 によるコミット済みの更新値を得たために問題が起きました。そこで以下の規則を設けます：

> トランザクションは開始時点で既に終了しているトランザクションが作成したデータバージョンのみを読み取ることができる

この規則により、トランザクションは以下を無視する必要があります：

1.  自身の開始後に開始したトランザクションのデータ
2.  自身の開始時点でまだアクティブなトランザクションのデータ

1 つ目はトランザクション ID の比較で判定可能です。2 つ目は、トランザクション Ti 開始時にアクティブなすべてのトランザクションのスナップショット SP(Ti) を記録し、XMIN が SP(Ti) に含まれている場合、そのバージョンは Ti に対して不可視とします。

以上より、リピータブルリードの可視性判定ロジックは以下のようになります：

```
(XMIN == Ti and                 // Ti によって作成され、
 (XMAX == NULL                  // まだ削除されていない
))
or                              // または
(XMIN がコミット済みであり、       // コミット済みトランザクションによって作成され、
 XMIN < XID and                 // そのトランザクション ID が Ti より小さく、
 XMIN が SP(Ti) に含まれていない、  // Ti 開始時点でアクティブでない
 (XMAX == NULL or               // まだ削除されていないか、
  (XMAX != Ti and               // 他のトランザクションによって削除されているが、
   (XMAX は未コミットまたは       // そのトランザクションは未コミットか、
XMAX > Ti または                // Ti 開始後に開始されたか、
XMAX は SP(Ti) に含まれている))    // Ti 開始時点でアクティブである
))))
```

これを実装するため、トランザクションのスナップショット情報を保持する構造体を用意します：

```java
public class Transaction {
    public long xid;
    public int level;
    public Map<Long, Boolean> snapshot;
    public Exception err;
    public boolean autoAborted;

    public static Transaction newTransaction(long xid, int level, Map<Long, Transaction> active) {
        Transaction t = new Transaction();
        t.xid = xid;
        t.level = level;
        if(level != 0) {
            t.snapshot = new HashMap<>();
            for(Long x : active.keySet()) {
                t.snapshot.put(x, true);
            }
        }
        return t;
    }

    public boolean isInSnapshot(long xid) {
        if(xid == TransactionManagerImpl.SUPER_XID) {
            return false;
        }
        return snapshot.containsKey(xid);
    }
}
```

コンストラクタの引数 active は現在アクティブなすべてのトランザクションを保持しています。これにより、リピータブルリードの分離レベルでのバージョンの可視性判定は以下のようになります：

```java
private static boolean repeatableRead(TransactionManager tm, Transaction t, Entry e) {
    long xid = t.xid;
    long xmin = e.getXmin();
    long xmax = e.getXmax();
    if(xmin == xid && xmax == 0) return true;

    if(tm.isCommitted(xmin) && xmin < xid && !t.isInSnapshot(xmin)) {
        if(xmax == 0) return true;
        if(xmax != xid) {
            if(!tm.isCommitted(xmax) || xmax > xid || t.isInSnapshot(xmax)) {
                return true;
            }
        }
    }
    return false;
}
```