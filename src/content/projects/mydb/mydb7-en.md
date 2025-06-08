---
title: MYDB 7. Deadlock Detection and VM Implementation
lang: en
published: 2021-12-23T21:20:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb7
description: "The VM layer needs to handle version skipping and deadlock issues caused by MVCC. With a simple marking mechanism, MYDB can easily undo or roll back transactions, ensuring that data from aborted transactions never affects others. This design makes transaction processing under concurrency more efficient and reliable, sidestepping the common deadlock risks of traditional 2PL methods and boosting overall system stability and performance."
---
All code referenced in this chapter can be found in [backend/vm](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/vm).

### Preface

This section wraps up the VM layer by introducing the problem of version skipping caused by MVCC, and how MYDB avoids deadlocks introduced by 2PL, integrating both into the Version Manager.

### The Version Skipping Problem

Before diving into version skipping, let’s briefly note that MVCC makes undoing or rolling back transactions in MYDB extremely simple: you only need to mark the transaction as aborted. Based on the visibility rules mentioned in the previous chapter, each transaction only sees data produced by other committed transactions. Any data written by an aborted transaction is invisible to others—as if the transaction never existed.

Now, on to version skipping. Consider the following scenario: suppose X initially has only version x0, and both T1 and T2 use the Repeatable Read isolation level.

```
T1 begin
T2 begin
R1(X) // T1 reads x0
R2(X) // T2 reads x0
U1(X) // T1 updates X to x1
T1 commit
U2(X) // T2 updates X to x2
T2 commit
```

This works fine in practice, but logically there’s an inconsistency: T1 correctly updates X from x0 to x1, but then T2 updates X from x0 to x2, skipping over x1 entirely.

Read Committed permits version skipping, while Repeatable Read does not. The solution is straightforward: if Ti wants to modify X, but X has already been modified by a transaction Tj that’s invisible to Ti, Ti must roll back.

As summarized in the last section, a transaction Tj is invisible to Ti in two cases:

1.  XID(Tj) > XID(Ti)
2.  Tj is in the snapshot set SP(Ti)

Therefore, checking for version skipping boils down to retrieving the latest committed version of X and testing whether it’s visible to the current transaction:

```java
public static boolean isVersionSkip(TransactionManager tm, Transaction t, Entry e) {
    long xmax = e.getXmax();
    if (t.level == 0) {
        return false;
    } else {
        return tm.isCommitted(xmax) && (xmax > t.xid || t.isInSnapshot(xmax));
    }
}
```

### Deadlock Detection

In the previous section, we noted that 2PL can block transactions until the lock holder releases the lock. This wait relationship can be modeled as a directed edge: e.g., if Tj is waiting on Ti, represent this as Tj --> Ti. All such directed edges form a graph (not necessarily connected). Detecting a deadlock simply means checking if this graph contains a cycle.

MYDB employs a LockTable object that maintains this graph in memory. Here’s how it’s structured:

```java
public class LockTable {

    private Map<Long, List<Long>> x2u;  // Resources acquired by each XID
    private Map<Long, Long> u2x;        // Which XID holds each resource UID
    private Map<Long, List<Long>> wait; // XIDs waiting for each UID
    private Map<Long, Lock> waitLock;   // Locks for XIDs waiting on resources
    private Map<Long, Long> waitU;      // UID currently awaited by each XID
    private Lock lock;

    ...
}
```

Each time there’s a need to wait for a resource, an edge is added to the graph and deadlock detection is carried out. If a deadlock is found, the edge is removed and the transaction is rolled back.

```java
// Returns null if no wait is needed, otherwise the lock object.
// Throws an exception if a deadlock would be caused.
public Lock add(long xid, long uid) throws Exception {
    lock.lock();
    try {
        if (isInList(x2u, xid, uid)) {
            return null;
        }
        if (!u2x.containsKey(uid)) {
            u2x.put(uid, xid);
            putIntoList(x2u, xid, uid);
            return null;
        }
        waitU.put(xid, uid);
        putIntoList(wait, xid, uid);
        if (hasDeadLock()) {
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

When you call `add`, if the caller needs to wait, a locked Lock object is returned and the caller should attempt to acquire it—blocking the thread as intended, e.g.:

```java
Lock l = lt.add(xid, uid);
if (l != null) {
    l.lock();   // Block here
    l.unlock();
}
```

Cycle detection in the graph is a simple DFS; note the graph may not be connected. The idea is to assign a visit mark to each node, initializing all to -1. Then for each unmarked node, start a DFS, marking all nodes traversed in that connected component with a unique number. If a node is visited more than once within the same traversal, a cycle exists.

Here’s how it's done:

```java
private boolean hasDeadLock() {
    xidStamp = new HashMap<>();
    stamp = 1;
    for (long xid : x2u.keySet()) {
        Integer s = xidStamp.get(xid);
        if (s != null && s > 0) {
            continue;
        }
        stamp++;
        if (dfs(xid)) {
            return true;
        }
    }
    return false;
}

private boolean dfs(long xid) {
    Integer stp = xidStamp.get(xid);
    if (stp != null && stp == stamp) {
        return true;
    }
    if (stp != null && stp < stamp) {
        return false;
    }
    xidStamp.put(xid, stamp);

    Long uid = waitU.get(xid);
    if (uid == null) return false;
    Long x = u2x.get(uid);
    assert x != null;
    return dfs(x);
}
```

When a transaction is committed or aborted, all of its held locks can be released and it is removed from the wait graph:

```java
public void remove(long xid) {
    lock.lock();
    try {
        List<Long> l = x2u.get(xid);
        if (l != null) {
            while (l.size() > 0) {
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

The `while` loop releases all resources held by the thread, making these available to waiting threads:

```java
// Selects a new XID from the wait queue to hold uid
private void selectNewXID(long uid) {
    u2x.remove(uid);
    List<Long> l = wait.get(uid);
    if (l == null) return;
    assert l.size() > 0;
    while (l.size() > 0) {
        long xid = l.remove(0);
        if (!waitLock.containsKey(xid)) {
            continue;
        } else {
            u2x.put(uid, xid);
            Lock lo = waitLock.remove(xid);
            waitU.remove(xid);
            lo.unlock();
            break;
        }
    }
    if (l.size() == 0) wait.remove(uid);
}
```

Unlocking happens from the beginning of the list, making it a fair lock. Unlocking the Lock object lets the business thread proceed.

### Implementation of VM

The VM layer exposes its functionality to the upper layers via the VersionManager interface:

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

In addition, the VM implementation is designed as a cache for Entry objects, and thus needs to inherit from `AbstractCache<Entry>`. The methods for acquiring and releasing cache entries are simple:

```java
@Override
protected Entry getForCache(long uid) throws Exception {
    Entry entry = Entry.loadEntry(this, uid);
    if (entry == null) {
        throw Error.NullEntryException;
    }
    return entry;
}

@Override
protected void releaseForCache(Entry entry) {
    entry.remove();
}
```

`begin()` starts a transaction, initializes its data structure, and stores it in `activeTransaction` for checks and snapshot use:

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

The `commit()` method finalizes a transaction—freeing internal structures, releasing held locks, and updating the TM state:

```java
@Override
public void commit(long xid) throws Exception {
    lock.lock();
    Transaction t = activeTransaction.get(xid);
    lock.unlock();
    try {
        if (t.err != null) {
            throw t.err;
        }
    } catch (NullPointerException n) {
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

There are two ways to abort a transaction: manually and automatically. Manual means calling `abort()` directly. Automatic abort happens when a deadlock is detected or on version skipping:

```java
private void internAbort(long xid, boolean autoAborted) {
    lock.lock();
    Transaction t = activeTransaction.get(xid);
    if (!autoAborted) {
        activeTransaction.remove(xid);
    }
    lock.unlock();
    if (t.autoAborted) return;
    lt.remove(xid);
    tm.abort(xid);
}
```

The `read()` method simply fetches an entry and checks whether it’s visible:

```java
@Override
public byte[] read(long xid, long uid) throws Exception {
    lock.lock();
    Transaction t = activeTransaction.get(xid);
    lock.unlock();
    if (t.err != null) {
        throw t.err;
    }
    Entry entry = super.get(uid);
    try {
        if (Visibility.isVisible(tm, t, entry)) {
            return entry.data();
        } else {
            return null;
        }
    } finally {
        entry.release();
    }
}
```

`insert()` wraps the data as an Entry and directly hands it off to the DM for insertion:

```java
@Override
public long insert(long xid, byte[] data) throws Exception {
    lock.lock();
    Transaction t = activeTransaction.get(xid);
    lock.unlock();
    if (t.err != null) {
        throw t.err;
    }
    byte[] raw = Entry.wrapEntryRaw(xid, data);
    return dm.insert(xid, raw);
}
```

The `delete()` method is a bit more involved:

```java
@Override
public boolean delete(long xid, long uid) throws Exception {
    lock.lock();
    Transaction t = activeTransaction.get(xid);
    lock.unlock();

    if (t.err != null) {
        throw t.err;
    }
    Entry entry = super.get(uid);
    try {
        if (!Visibility.isVisible(tm, t, entry)) {
            return false;
        }
        Lock l = null;
        try {
            l = lt.add(xid, uid);
        } catch (Exception e) {
            t.err = Error.ConcurrentUpdateException;
            internAbort(xid, true);
            t.autoAborted = true;
            throw t.err;
        }
        if (l != null) {
            l.lock();
            l.unlock();
        }
        if (entry.getXmax() == xid) {
            return false;
        }
        if (Visibility.isVersionSkip(tm, t, entry)) {
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

Essentially, the process boils down to three steps: visibility checking, acquiring the resource lock, and verifying version skipping. The only action required for a delete is to set XMAX.

Today is December 24, 2021—Christmas Eve.

> I wish you a brilliant future  
> I wish lovers may finally unite  
> I wish you happiness in this world  
> I only wish, facing the sea, warm flowers bloom