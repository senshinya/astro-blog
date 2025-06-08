---
title: MYDB 7. デッドロック検出と VM の実装
lang: ja
published: 2021-12-23T21:20:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb7
description: "VM は MVCC によるバージョンジャンプやデッドロック問題を処理する必要があります。シンプルなマーク方式により、MYDB はトランザクションの取り消しやロールバックを容易に行い、中止されたトランザクションのデータが他のトランザクションに影響を与えないことを保証します。この設計により、トランザクションは並行処理時により効率的かつ信頼性高く動作し、従来の 2PL 手法でよく見られるデッドロックリスクを回避し、システム全体の安定性と性能を向上させています。"
---
本章で扱うコードはすべて [backend/vm](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/vm) にあります。

### はじめに

本節では VM 層のまとめとして、MVCC が引き起こす可能性のあるバージョンジャンプ問題と、MYDB が 2PL によるデッドロックをどのように回避しているかを解説し、それらを統合した Version Manager について紹介します。

### バージョンジャンプ問題

バージョンジャンプの話をする前に、ついでに触れておくと、MVCC の実装により、MYDB ではトランザクションの取り消しやロールバックが非常に簡単です。具体的には、そのトランザクションを aborted（中止）としてマークするだけで済みます。前章で述べた可視性ルールにより、各トランザクションは他のコミット済みトランザクションが生成したデータのみを参照でき、中止されたトランザクションのデータは他のトランザクションに一切影響を与えません。つまり、そのトランザクションは存在しなかったのと同じ扱いになります。

バージョンジャンプ問題を考えるために、以下の状況を想定します。X は最初に x0 バージョンのみ存在し、T1 と T2 はどちらもリピート可能読取（可読性レベル）であるとします。

```
T1 begin
T2 begin
R1(X) // T1 は x0 を読み取る
R2(X) // T2 は x0 を読み取る
U1(X) // T1 は X を x1 に更新
T1 commit
U2(X) // T2 は X を x2 に更新
T2 commit
```

このケースは実際に動作させると問題ありませんが、論理的には正しくありません。T1 は X を x0 から x1 に更新したのは正しいですが、T2 は x0 から x2 に直接更新しており、x1 バージョンを飛ばしています。

読み取りコミット（Read Committed）ではバージョンジャンプが許容されますが、リピート可能読取（Repeatable Read）では許されません。バージョンジャンプを防ぐ考え方はシンプルで、もし Ti が X を更新しようとしていて、X が Ti にとって不可視なトランザクション Tj によってすでに更新されていたら、Ti をロールバックさせるというものです。

前節でまとめたように、Ti にとって不可視な Tj は以下の 2 つのケースがあります：

1.  XID(Tj) > XID(Ti)
2.  Tj が SP(Ti) に含まれる

したがって、バージョンジャンプのチェックも簡単で、更新対象のデータ X の最新コミットバージョンを取得し、その作成者が現在のトランザクションに対して可視かどうかを判定します。

```java
public static boolean isVersionSkip(TransactionManager tm, Transaction t, Entry e) {
    long xmax = e.getXmax();
    if(t.level == 0) {
        return false;
    } else {
        return tm.isCommitted(xmax) && (xmax > t.xid  t.isInSnapshot(xmax));
  }
}
```

### デッドロック検出

前節で述べた通り、2PL はトランザクションをロック解放までブロックします。この待機関係は有向辺として抽象化でき、例えば Tj が Ti を待っている場合は Tj --> Ti と表現できます。こうして無数の有向辺がグラフを形成し（必ずしも連結グラフではありません）、デッドロック検出はこのグラフにサイクルが存在するかどうかを調べるだけで済みます。

MYDB は LockTable オブジェクトを用いて、このグラフをメモリ上で管理しています。管理構造は以下の通りです：

```java
public class LockTable {

    private Map<Long, List<Long>> x2u;  // ある XID が保持しているリソース UID のリスト
    private Map<Long, Long> u2x;        // UID が保持されている XID
    private Map<Long, List<Long>> wait; // UID を待っている XID のリスト
    private Map<Long, Lock> waitLock;   // 待機中の XID のロック
    private Map<Long, Long> waitU;      // XID が待っている UID
    private Lock lock;

    ...
}
```

待機が発生するたびにグラフに辺を追加し、デッドロック検出を行います。デッドロックが検出された場合はその辺を追加せず、トランザクションを中止します。

```java
// 待機不要なら null を返し、そうでなければロックオブジェクトを返す
// デッドロックが発生する場合は例外を投げる
public Lock add(long xid, long uid) throws Exception {
    lock.lock();
    try {
        if(isInList(x2u, xid, uid)) {
            return null;
        }
        if(!u2x.containsKey(uid)) {
            u2x.put(uid, xid);
            putIntoList(x2u, xid, uid);
            return null;
        }
        waitU.put(xid, uid);
        putIntoList(wait, xid, uid);
        if(hasDeadLock()) {
            waitU.remove(xid);
            removeFromList(wait, uid, xid);
            throw Error.DeadlockException;
        }
        Lock l = new ReentrantLock();
        l.lock();
        waitLock.put(xid, l);
        return l;
    } finally {
        lock.unlock();
    }
}
```

add を呼び出すと、待機が必要な場合はロック済みの Lock オブジェクトが返されます。呼び出し元はこのオブジェクトのロック取得を試みることでスレッドをブロックします。例：

```java
Lock l = lt.add(xid, uid);
if(l != null) {
    l.lock();   // ここでブロック
    l.unlock();
}
```

グラフにサイクルがあるかどうかを調べるアルゴリズムは非常にシンプルで、深さ優先探索（DFS）を用います。ただし、このグラフは必ずしも連結ではないため注意が必要です。各ノードに訪問スタンプを設定し、初期値は -1 にします。すべてのノードを巡回し、スタンプが -1 でないノードを根として DFS を行い、その連結成分のノードに同じスタンプを付与します。もし DFS 中に同じスタンプのノードに再訪問した場合、サイクルが存在すると判定します。

実装例：

```java
private boolean hasDeadLock() {
    xidStamp = new HashMap<>();
    stamp = 1;
    for(long xid : x2u.keySet()) {
        Integer s = xidStamp.get(xid);
        if(s != null && s > 0) {
            continue;
        }
        stamp ++;
        if(dfs(xid)) {
            return true;
        }
    }
    return false;
}

private boolean dfs(long xid) {
    Integer stp = xidStamp.get(xid);
    if(stp != null && stp == stamp) {
        return true;
    }
    if(stp != null && stp < stamp) {
        return false;
    }
    xidStamp.put(xid, stamp);

    Long uid = waitU.get(xid);
    if(uid == null) return false;
    Long x = u2x.get(uid);
    assert x != null;
    return dfs(x);
}
```

トランザクションがコミットまたはアボートされる際には、保持しているすべてのロックを解放し、自身を待機グラフから削除します。

```java
public void remove(long xid) {
    lock.lock();
    try {
        List<Long> l = x2u.get(xid);
        if(l != null) {
            while(l.size() > 0) {
                Long uid = l.remove(0);
                selectNewXID(uid);
            }
        }
        waitU.remove(xid);
        x2u.remove(xid);
        waitLock.remove(xid);
    } finally {
        lock.unlock();
    }
}
```

while ループでそのスレッドが保持するすべてのリソースのロックを解放し、これらのリソースは待機中のスレッドに割り当てられます。

```java
// 待機キューから xid を選び uid を占有させる
private void selectNewXID(long uid) {
    u2x.remove(uid);
    List<Long> l = wait.get(uid);
    if(l == null) return;
    assert l.size() > 0;
    while(l.size() > 0) {
        long xid = l.remove(0);
        if(!waitLock.containsKey(xid)) {
            continue;
        } else {
            u2x.put(uid, xid);
            Lock lo = waitLock.remove(xid);
            waitU.remove(xid);
            lo.unlock();
            break;
        }
    }
    if(l.size() == 0) wait.remove(uid);
}
```

リストの先頭から順にロック解除を試みるため、公平なロックとなっています。ロック解除は Lock オブジェクトの unlock メソッドを呼ぶだけで、これにより待機中のスレッドがロックを取得し、処理を続行できます。

### VM の実装

VM 層は VersionManager インターフェースを通じて上位層に以下の機能を提供します：

```java
public interface VersionManager {
    byte[] read(long xid, long uid) throws Exception;
    long insert(long xid, byte[] data) throws Exception;
    boolean delete(long xid, long uid) throws Exception;

    long begin(int level);
    void commit(long xid) throws Exception;
    void abort(long xid);
}
```

また、VM の実装クラスは Entry のキャッシュとしても設計されており、`AbstractCache<Entry>` を継承する必要があります。キャッシュ取得と解放のメソッドは以下のように簡単に実装できます：

```java
@Override
protected Entry getForCache(long uid) throws Exception {
    Entry entry = Entry.loadEntry(this, uid);
    if(entry == null) {
        throw Error.NullEntryException;
    }
    return entry;
}

@Override
protected void releaseForCache(Entry entry) {
    entry.remove();
}
```

`begin()` はトランザクションを開始し、トランザクション構造を初期化して activeTransaction に格納し、チェックやスナップショットに利用します：

```java
@Override
public long begin(int level) {
    lock.lock();
    try {
        long xid = tm.begin();
        Transaction t = Transaction.newTransaction(xid, level, activeTransaction);
        activeTransaction.put(xid, t);
        return xid;
    } finally {
        lock.unlock();
    }
}
```

`commit()` はトランザクションをコミットし、関連構造の解放、保持ロックの解放、TM 状態の更新を行います：

```java
@Override
public void commit(long xid) throws Exception {
    lock.lock();
    Transaction t = activeTransaction.get(xid);
    lock.unlock();
    try {
        if(t.err != null) {
            throw t.err;
        }
    } catch(NullPointerException n) {
        System.out.println(xid);
        System.out.println(activeTransaction.keySet());
        Panic.panic(n);
    }
    lock.lock();
    activeTransaction.remove(xid);
    lock.unlock();
    lt.remove(xid);
    tm.commit(xid);
}
```

abort は手動と自動の 2 種類があります。手動は abort() メソッドの呼び出しで、自動はデッドロック検出やバージョンジャンプ検出時に自動的にロールバックされます：

```java
private void internAbort(long xid, boolean autoAborted) {
    lock.lock();
    Transaction t = activeTransaction.get(xid);
    if(!autoAborted) {
        activeTransaction.remove(xid);
    }
    lock.unlock();
    if(t.autoAborted) return;
    lt.remove(xid);
    tm.abort(xid);
}
```

`read()` はエントリを読み込み、可視性を判定します：

```java
@Override
public byte[] read(long xid, long uid) throws Exception {
    lock.lock();
    Transaction t = activeTransaction.get(xid);
    lock.unlock();
    if(t.err != null) {
        throw t.err;
    }
    Entry entry = super.get(uid);
    try {
        if(Visibility.isVisible(tm, t, entry)) {
            return entry.data();
        } else {
            return null;
        }
    } finally {
        entry.release();
    }
}
```

`insert()` はデータを Entry に包み込み、DM に渡して挿入します：

```java
@Override
public long insert(long xid, byte[] data) throws Exception {
    lock.lock();
    Transaction t = activeTransaction.get(xid);
    lock.unlock();
    if(t.err != null) {
        throw t.err;
    }
    byte[] raw = Entry.wrapEntryRaw(xid, data);
    return dm.insert(xid, raw);
}
```

`delete()` はやや複雑ですが、主に以下の 3 つの前処理を行います：可視性の判定、リソースロックの取得、バージョンジャンプの判定。削除操作自体は XMAX の設定のみです。

```java
@Override
public boolean delete(long xid, long uid) throws Exception {
    lock.lock();
    Transaction t = activeTransaction.get(xid);
    lock.unlock();

    if(t.err != null) {
        throw t.err;
    }
    Entry entry = super.get(uid);
    try {
        if(!Visibility.isVisible(tm, t, entry)) {
            return false;
        }
        Lock l = null;
        try {
            l = lt.add(xid, uid);
        } catch(Exception e) {
            t.err = Error.ConcurrentUpdateException;
            internAbort(xid, true);
            t.autoAborted = true;
            throw t.err;
        }
        if(l != null) {
            l.lock();
            l.unlock();
        }
        if(entry.getXmax() == xid) {
            return false;
        }
        if(Visibility.isVersionSkip(tm, t, entry)) {
            t.err = Error.ConcurrentUpdateException;
            internAbort(xid, true);
            t.autoAborted = true;
            throw t.err;
        }
        entry.setXmax(xid);
        return true;
    } finally {
        entry.release();
    }
}
```

---

今日は 2021 年 12 月 24 日、クリスマス・イヴです。

> あなたに輝かしい未来がありますように  
> あなたの恋人が幸せな結ばれ方をしますように  
> あなたがこの世で幸福を得られますように  
> 私はただ、海に面して春の暖かさと花の咲く日々を願うのみです