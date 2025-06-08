---
title: MYDB 6. Record Versions and Transaction Isolation Levels
lang: en
published: 2021-12-18T14:58:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb6
description: "The Version Manager enforces serializability of scheduling sequences using the two-phase locking protocol and introduces Multi-Version Concurrency Control (MVCC) to eliminate read-write blocking. It also defines conflicts in database operations, with a particular focus on the interplay between update and read operations, laying the foundation for understanding transaction isolation levels."
---
All the code in this chapter can be found in [backend/vm](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/vm).

### Introduction

Starting from this chapter, we will discuss the Version Manager.

> The Version Manager (VM) implements schedule serializability using the two-phase locking protocol (2PL), and applies MVCC to eliminate read-write blocking. It also supports two isolation levels.

Just as the Data Manager forms the core of MYDB's data management, the Version Manager is the core module responsible for managing transactions and record versions.

### 2PL and MVCC

#### Conflicts and Two-Phase Locking (2PL)

First, let's define what constitutes a conflict in a database. For now, let's set aside insert operations and focus only on update (U) and read (R) actions. Two operations are said to be in conflict if they satisfy all of the following conditions:

1.  The two operations are executed by different transactions.
2.  Both operations involve the same data item.
3.  At least one of these operations is an update.

Given these conditions, there are only two conflict cases in operations on the same data item:

1.  Update–Update (U-U) conflicts between two different transactions.
2.  Update–Read (U-R) conflicts between two different transactions.

Why do we care about conflicts? The key is that **swapping the order of two non-conflicting operations does not affect the final result**, while swapping the order of two conflicting operations does.

Recall the example from Chapter 4, where two transactions operate on `x` concurrently. Suppose the initial value of `x` is 0:

```
T1 begin
T2 begin
R1(x) // T1 reads 0
R2(x) // T2 reads 0
U1(0+1) // T1 tries to set x = x+1
U2(0+1) // T2 tries to set x = x+1
T1 commit
T2 commit
```

The final value of `x` is 1, which is not what we expect.

One of VM’s primary responsibilities is to ensure schedule serializability. MYDB achieves this using the two-phase locking protocol (2PL). With 2PL, if transaction `i` has already locked `x`, and another transaction `j` wants to operate on `x` in a way that conflicts with what `i` has done, then `j` will be blocked. For instance, if T1 has locked `x` via U1(x), then T2’s attempts to read or write `x` will be blocked until T1 releases the lock.

2PL indeed ensures serializable schedules, but it inevitably causes blocking between transactions, and might even lead to deadlocks. In order to enhance concurrency and reduce blocking, MYDB uses MVCC.

#### Multi-Version Concurrency Control (MVCC)

Before diving into MVCC, we need to clarify the concepts of "record" and "version".

At the DM layer, the primary concept is a data item. The Version Manager (VM) abstracts from the data items it manages and exposes the concept of a **record** (Entry) to upper layers. The smallest unit the upper layer modules deal with is the record. Internally, VM maintains multiple **versions** of each record. Every time an upper layer module modifies a record, VM creates a new version for that record.

With MVCC, MYDB significantly reduces the probability of transactional blocking. For example, suppose T1 wants to update the value of record X. T1 first acquires the lock on X and creates a new version, say `x3`. If T1 hasn't released the lock on X and T2 then wants to read X, T2 won't be blocked—MYDB simply returns an earlier version of X, such as `x2`. Thus, the outcome is equivalent to T2 having executed before T1, and the schedule remains serializable. If there is no older version of X, then T2 must wait for T1 to release the lock. In this way, blocking is reduced but not completely eliminated.

Recall from Chapter 4 the requirement for recoverable data: the sequence of operations passed from VM to DM must obey the following two rules:

> Rule 1: An active transaction cannot read any data produced by uncommitted transactions.  
> Rule 2: An active transaction cannot modify any data produced or modified by uncommitted transactions.

Thanks to 2PL and MVCC in MYDB, these requirements are trivially satisfied.

### How Records Are Implemented

Each MYDB record is encapsulated in the `Entry` class. Even though MVCC theoretically supports multiple versions, the VM layer doesn’t provide an "update" operation directly—for field modifications, this is handled by the Table and Field Manager (TBM) module later on. So, in VM’s implementation, each record has only a single version.

Each record is stored in a single data item, which means `Entry` only needs to hold a reference to a `DataItem`:

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

The data format stored in an Entry is as follows:

```
[XMIN] [XMAX] [DATA]
```

- **XMIN:** The transaction ID that created this record (version).
- **XMAX:** The transaction ID that deleted this record (version).
- **DATA:** The actual content of the record.

The purpose of XMIN and XMAX will be clarified in the next section. To create a record in this structure, the `wrapEntryRaw()` method is used:

```java
public static byte[] wrapEntryRaw(long xid, byte[] data) {
    byte[] xmin = Parser.long2Byte(xid);
    byte[] xmax = new byte[8];
    return Bytes.concat(xmin, xmax, data);
}
```

Similarly, to extract the record’s data, you must parse according to this layout:

```java
// Return the content as a copy
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

Here, the method returns a copy of the data. If you need to modify it, you have to call `before()` on the DataItem first—this is particularly reflected in how XMAX is set:

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

The `before()` and `after()` calls define the proper way to update a data item, as described in the DataItem section.

### Transaction Isolation Levels

#### Read Committed

As described earlier, if the newest version of a record is locked, and another transaction attempts to read or modify the record, MYDB will return an older version. The newly locked version is invisible to the other transaction, introducing the concept of **version visibility**.

Version visibility is closely related to transaction isolation levels. The lowest isolation level supported by MYDB is **Read Committed**, meaning a transaction can only read versions produced by committed transactions. The rationale for enforcing at least this level—prevention of cascading rollbacks and consistency with commit semantics—was explained in Chapter 4.

To support Read Committed, MYDB maintains two variables for each version, XMIN and XMAX (as mentioned above):

- **XMIN**: Transaction ID that created the version
- **XMAX**: Transaction ID that deleted the version

XMIN is set at version creation; XMAX is set when the version is deleted or replaced.

The idea behind XMAX also explains why the DM layer doesn’t offer a direct "delete" operation. To delete a version, simply set its XMAX—the version will then be invisible to transactions that start after XMAX, which is functionally equivalent to deletion.

Under Read Committed, the visibility rules for a version regarding a transaction Ti are:

```
(XMIN == Ti and                             // Created by Ti and
    XMAX == NULL                            // Not deleted yet
)
or                                          // or
(XMIN is committed and                      // Created by a committed transaction and
    (XMAX == NULL or                        // Not deleted yet or
    (XMAX != Ti and XMAX is not committed)  // Deleted by an uncommitted transaction
))
```

If the conditions are true, the version is visible to Ti. To find Ti’s visible version, start from the latest and check each version’s visibility in order.

Below is the method for determining if a record is visible to transaction t:

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

The Transaction structure here simply holds the transaction’s XID.

#### Repeatable Read

It’s well known that Read Committed can lead to problems such as non-repeatable reads and phantom reads. Here, we address the non-repeatable read problem.

A non-repeatable read means a transaction reads different results in separate reads of the same data item. For example, if X starts at 0:

```
T1 begin
R1(X) // T1 reads 0
T2 begin
U2(X) // T2 updates X to 1
T2 commit
R1(X) // T1 reads 1
```

As shown, T1 reads different values for X at different times. To avoid this, we need to increase the isolation level to **Repeatable Read**.

The root of the problem is that T1’s second read sees T2’s committed update. Thus, we define:

> A transaction may only read data versions produced by transactions that were committed before it started.

This rule further requires a transaction to ignore:

1. Data from transactions that started after itself,
2. Data from transactions that were active when it began.

The first is easily enforced by comparing transaction IDs. To enforce the second, at the start of transaction Ti, we record a snapshot SP(Ti) of all active transactions. If a version’s XMIN is in SP(Ti), it should be invisible to Ti.

Thus, the visibility rules for Repeatable Read:

```
(XMIN == Ti and                        // Created by Ti and
 (XMAX == NULL                         // Not deleted yet
))
or                                     // or
(XMIN is committed and                 // Created by a committed transaction and
 XMIN < XID and                        // That transaction started before Ti and
 XMIN not in SP(Ti) and                // That transaction committed before Ti began and
 (XMAX == NULL or                      // Not deleted yet or
  (XMAX != Ti and                      // Deleted by another transaction but
   (XMAX is not committed or           // That transaction has not committed or
    XMAX > Ti or                       // That transaction started after Ti or
    XMAX in SP(Ti)                     // That transaction was still active when Ti began
))))
```

This calls for a `Transaction` structure with a snapshot of active transactions at start:

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

The `active` parameter captures currently active transactions when the constructor is called. The Repeatable Read visibility check is implemented as:

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