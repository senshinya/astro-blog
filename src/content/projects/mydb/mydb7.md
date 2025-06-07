---
title: MYDB 7. 死锁检测与 VM 的实现
lang: zh
published: 2021-12-23T21:20:00+08:00
tags: ["java", "mydb"]
description: "VM 需要处理 MVCC 导致的版本跳跃及死锁问题。通过简单的标记方式，MYDB 能轻松撤销或回滚事务，确保 aborted 事务的数据不会影响其他事务。这种设计使得事务在处理并发时更为高效和可靠，避免了传统 2PL 方法常见的死锁风险，提升了整体系统的稳定性和性能。"
---
本章涉及代码都在 [backend/vm](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/vm) 中。

### 前言

本节将收尾 VM 层，介绍一下 MVCC 可能导致的版本跳跃问题，以及 MYDB 如何避免 2PL 导致的死锁，并将其整合为 Version Manager。

### 版本跳跃问题

说到版本跳跃之前，顺便提一嘴，MVCC 的实现，使得 MYDB 在撤销或是回滚事务很简单：只需要将这个事务标记为 aborted 即可。根据前一章提到的可见性，每个事务都只能看到其他 committed 的事务所产生的数据，一个 aborted 事务产生的数据，就不会对其他事务产生任何影响了，也就相当于，这个事务不曾存在过。

版本跳跃问题，考虑如下的情况，假设 X 最初只有 x0 版本，T1 和 T2 都是可重复读的隔离级别：

```
T1 begin
T2 begin
R1(X) // T1 读取 x0
R2(X) // T2 读取 x0
U1(X) // T1 将 X 更新到 x1
T1 commit
U2(X) // T2 将 X 更新到 x2
T2 commit
```

这种情况实际运行起来是没问题的，但是逻辑上不太正确。T1 将 X 从 x0 更新为了 x1，这是没错的。但是 T2 则是将 X 从 x0 更新成了 x2，跳过了 x1 版本。

读提交是允许版本跳跃的，而可重复读则是不允许版本跳跃的。解决版本跳跃的思路也很简单：如果 Ti 需要修改 X，而 X 已经被 Ti 不可见的事务 Tj 修改了，那么要求 Ti 回滚。

上一节中就总结了，Ti 不可见的 Tj，有两种情况：

1.  XID(Tj) > XID(Ti)
2.  Tj in SP(Ti)

于是版本跳跃的检查也就很简单了，取出要修改的数据 X 的最新提交版本，并检查该最新版本的创建者对当前事务是否可见：

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

### 死锁检测

上一节提到了 2PL 会阻塞事务，直至持有锁的线程释放锁。可以将这种等待关系抽象成有向边，例如 Tj 在等待 Ti，就可以表示为 Tj --> Ti。这样，无数有向边就可以形成一个图（不一定是连通图）。检测死锁也就简单了，只需要查看这个图中是否有环即可。

MYDB 使用一个 LockTable 对象，在内存中维护这张图。维护结构如下：

```java
public class LockTable {

    private Map<Long, List<Long>> x2u;  // 某个 XID 已经获得的资源的 UID 列表
    private Map<Long, Long> u2x;        // UID 被某个 XID 持有
    private Map<Long, List<Long>> wait; // 正在等待 UID 的 XID 列表
    private Map<Long, Lock> waitLock;   // 正在等待资源的 XID 的锁
    private Map<Long, Long> waitU;      // XID 正在等待的 UID
    private Lock lock;

    ...
}
```

在每次出现等待的情况时，就尝试向图中增加一条边，并进行死锁检测。如果检测到死锁，就撤销这条边，不允许添加，并撤销该事务。

```java
// 不需要等待则返回 null，否则返回锁对象
// 会造成死锁则抛出异常
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

调用 add，如果需要等待的话，会返回一个上了锁的 Lock 对象。调用方在获取到该对象时，需要尝试获取该对象的锁，由此实现阻塞线程的目的，例如：

```java
Lock l = lt.add(xid, uid);
if(l != null) {
    l.lock();   // 阻塞在这一步
    l.unlock();
}
```

查找图中是否有环的算法也非常简单，就是一个深搜，只是需要注意这个图不一定是连通图。思路就是为每个节点设置一个访问戳，都初始化为 -1，随后遍历所有节点，以每个非 -1 的节点作为根进行深搜，并将深搜该连通图中遇到的所有节点都设置为同一个数字，不同的连通图数字不同。这样，如果在遍历某个图时，遇到了之前遍历过的节点，说明出现了环。

实现很简单：

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

在一个事务 commit 或者 abort 时，就可以释放所有它持有的锁，并将自身从等待图中删除。

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

while 循环释放掉了这个线程所有持有的资源的锁，这些资源可以被等待的线程所获取：

```java
// 从等待队列中选择一个 xid 来占用 uid
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

从 List 开头开始尝试解锁，还是个公平锁。解锁时，将该 Lock 对象 unlock 即可，这样业务线程就获取到了锁，就可以继续执行了。

### VM 的实现

VM 层通过 VersionManager 接口，向上层提供功能，如下：

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

同时，VM 的实现类还被设计为 Entry 的缓存，需要继承 `AbstractCache<Entry>`。需要实现的获取到缓存和从缓存释放的方法很简单：

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

`begin()` 开启一个事务，并初始化事务的结构，将其存放在 activeTransaction 中，用于检查和快照使用：

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

`commit()` 方法提交一个事务，主要就是 free 掉相关的结构，并且释放持有的锁，并修改 TM 状态：

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

abort 事务的方法则有两种，手动和自动。手动指的是调用 abort() 方法，而自动，则是在事务被检测出出现死锁时，会自动撤销回滚事务；或者出现版本跳跃时，也会自动回滚：

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

`read()` 方法读取一个 entry，注意判断下可见性即可：

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

`insert()` 则是将数据包裹成 Entry，无脑交给 DM 插入即可：

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

`delete()` 方法看起来略为复杂：

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

实际上主要是前置的三件事：一是可见性判断，二是获取资源的锁，三是版本跳跃判断。删除的操作只有一个设置 XMAX。

今天是 2021 年 12 月 24 日，平安夜。

> 愿你有一个灿烂的前程  
> 愿你有情人终成眷属  
> 愿你在尘世获得幸福  
> 我只愿面朝大海，春暖花开