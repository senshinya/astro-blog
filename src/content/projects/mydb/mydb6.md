---
title: MYDB 6. 记录的版本与事务隔离
lang: zh
published: 2021-12-18T14:58:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb6
description: "VM 通过两段锁协议确保调度序列的可串行化，并引入多版本并发控制（MVCC），以消除读写阻塞问题。此外还定义了数据库操作中的冲突，特别关注更新与读取操作的相互影响，为理解事务间的隔离级别奠定基础。"
---
本章涉及代码都在 [backend/vm](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/vm) 中。

### 前言

从这一章开始，我们开始讨论 Version Manager。

> VM 基于两段锁协议实现了调度序列的可串行化，并实现了 MVCC 以消除读写阻塞。同时实现了两种隔离级别。

类似于 Data Manager 是 MYDB 的数据管理核心，Version Manager 是 MYDB 的事务和数据版本的管理核心。

### 2PL 与 MVCC

#### 冲突与 2PL

首先来定义数据库的冲突，暂时不考虑插入操作，只看更新操作（U）和读操作（R），两个操作只要满足下面三个条件，就可以说这两个操作相互冲突：

1.  这两个操作是由不同的事务执行的
2.  这两个操作操作的是同一个数据项
3.  这两个操作至少有一个是更新操作

那么这样，对同一个数据操作的冲突，其实就只有下面这两种情况：

1.  两个不同事务的 U 操作冲突
2.  两个不同事务的 U、R 操作冲突

那么冲突或者不冲突，意义何在？作用在于，**交换两个互不冲突的操作的顺序，不会对最终的结果造成影响**，而交换两个冲突操作的顺序，则是会有影响的。

现在我们先抛开冲突不谈，记得在第四章举的例子吗，在并发情况下，两个事务同时操作 x。假设 x 的初值是 0：

```
T1 begin
T2 begin
R1(x) // T1 读到 0
R2(x) // T2 读到 0
U1(0+1) // T1 尝试把 x+1
U2(0+1) // T2 尝试把 x+1
T1 commit
T2 commit
```

最后 x 的结果是 1，这个结果显然与期望的不符。

VM 的一个很重要的职责，就是实现了调度序列的可串行化。MYDB 采用两段锁协议（2PL）来实现。当采用 2PL 时，如果某个事务 i 已经对 x 加锁，且另一个事务 j 也想操作 x，但是这个操作与事务 i 之前的操作相互冲突的话，事务 j 就会被阻塞。譬如，T1 已经因为 U1(x) 锁定了 x，那么 T2 对 x 的读或者写操作都会被阻塞，T2 必须等待 T1 释放掉对 x 的锁。

由此来看，2PL 确实保证了调度序列的可串行话，但是不可避免地导致了事务间的相互阻塞，甚至可能导致死锁。MYDB 为了提高事务处理的效率，降低阻塞概率，实现了 MVCC。

#### MVCC

在介绍 MVCC 之前，首先明确记录和版本的概念。

DM 层向上层提供了数据项（Data Item）的概念，VM 通过管理所有的数据项，向上层提供了记录（Entry）的概念。上层模块通过 VM 操作数据的最小单位，就是记录。VM 则在其内部，为每个记录，维护了多个版本（Version）。每当上层模块对某个记录进行修改时，VM 就会为这个记录创建一个新的版本。

MYDB 通过 MVCC，降低了事务的阻塞概率。譬如，T1 想要更新记录 X 的值，于是 T1 需要首先获取 X 的锁，接着更新，也就是创建了一个新的 X 的版本，假设为 x3。假设 T1 还没有释放 X 的锁时，T2 想要读取 X 的值，这时候就不会阻塞，MYDB 会返回一个较老版本的 X，例如 x2。这样最后执行的结果，就等价于，T2 先执行，T1 后执行，调度序列依然是可串行化的。如果 X 没有一个更老的版本，那只能等待 T1 释放锁了。所以只是降低了概率。

还记得我们在第四章中，为了保证数据的可恢复，VM 层传递到 DM 的操作序列需要满足以下两个规则：

> 规定 1：正在进行的事务，不会读取其他任何未提交的事务产生的数据。  
> 规定 2：正在进行的事务，不会修改其他任何未提交的事务修改或产生的数据。

由于 2PL 和 MVCC，我们可以看到，这两个条件都被很轻易地满足了。

### 记录的实现

对于一条记录来说，MYDB 使用 Entry 类维护了其结构。虽然理论上，MVCC 实现了多版本，但是在实现中，VM 并没有提供 Update 操作，对于字段的更新操作由后面的表和字段管理（TBM）实现。所以在 VM 的实现中，一条记录只有一个版本。

一条记录存储在一条 Data Item 中，所以 Entry 中保存一个 DataItem 的引用即可：

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

我们规定，一条 Entry 中存储的数据格式如下：

```
[XMIN] [XMAX] [DATA]
```

XMIN 是创建该条记录（版本）的事务编号，而 XMAX 则是删除该条记录（版本）的事务编号。它们的作用将在下一节中说明。DATA 就是这条记录持有的数据。根据这个结构，在创建记录时调用的 `wrapEntryRaw()` 方法如下：

```java
public static byte[] wrapEntryRaw(long xid, byte[] data) {
    byte[] xmin = Parser.long2Byte(xid);
    byte[] xmax = new byte[8];
    return Bytes.concat(xmin, xmax, data);
}
```

同样，如果要获取记录中持有的数据，也就需要按照这个结构来解析：

```java
// 以拷贝的形式返回内容
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

这里以拷贝的形式返回数据，如果需要修改的话，需要对 DataItem 执行 `before()` 方法，这个在设置 XMAX 的值中体现了：

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

`before()` 和 `after()` 是在 DataItem 一节中就已经确定的数据项修改规则。

### 事务的隔离级别

#### 读提交

上面提到，如果一个记录的最新版本被加锁，当另一个事务想要修改或读取这条记录时，MYDB 就会返回一个较旧的版本的数据。这时就可以认为，最新的被加锁的版本，对于另一个事务来说，是不可见的。于是版本可见性的概念就诞生了。

版本的可见性与事务的隔离度是相关的。MYDB 支持的最低的事务隔离程度，是“读提交”（Read Committed），即事务在读取数据时，只能读取已经提交事务产生的数据。保证最低的读提交的好处，第四章中已经说明（防止级联回滚与 commit 语义冲突）。

MYDB 实现读提交，为每个版本维护了两个变量，就是上面提到的 XMIN 和 XMAX：

- XMIN：创建该版本的事务编号
- XMAX：删除该版本的事务编号

XMIN 应当在版本创建时填写，而 XMAX 则在版本被删除，或者有新版本出现时填写。

XMAX 这个变量，也就解释了为什么 DM 层不提供删除操作，当想删除一个版本时，只需要设置其 XMAX，这样，这个版本对每一个 XMAX 之后的事务都是不可见的，也就等价于删除了。

如此，在读提交下，版本对事务的可见性逻辑如下：

```
(XMIN == Ti and                             // 由 Ti 创建且
    XMAX == NULL                            // 还未被删除
)
or                                          // 或
(XMIN is commited and                       // 由一个已提交的事务创建且
    (XMAX == NULL or                        // 尚未删除或
    (XMAX != Ti and XMAX is not commited)   // 由一个未提交的事务删除
))
```

若条件为 true，则版本对 Ti 可见。那么获取 Ti 适合的版本，只需要从最新版本开始，依次向前检查可见性，如果为 true，就可以直接返回。

以下方法判断某个记录对事务 t 是否可见：

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

这里的 Transaction 结构只提供了一个 XID。

#### 可重复读

读提交会导致的问题大家也都很清楚，八股也背了不少。那就是不可重复读和幻读。这里我们来解决不可重复读的问题。

不可重复度，会导致一个事务在执行期间对同一个数据项的读取得到不同结果。如下面的结果，加入 X 初始值为 0：

```
T1 begin
R1(X) // T1 读得 0
T2 begin
U2(X) // 将 X 修改为 1
T2 commit
R1(X) // T1 读的 1
```

可以看到，T1 两次读 X，读到的结果不一样。如果想要避免这个情况，就需要引入更严格的隔离级别，即可重复读（repeatable read）。

T1 在第二次读取的时候，读到了已经提交的 T2 修改的值，导致了这个问题。于是我们可以规定：

> 事务只能读取它开始时，就已经结束的那些事务产生的数据版本

这条规定，增加于，事务需要忽略：

1.  在本事务后开始的事务的数据;
2.  本事务开始时还是 active 状态的事务的数据

对于第一条，只需要比较事务 ID，即可确定。而对于第二条，则需要在事务 Ti 开始时，记录下当前活跃的所有事务 SP(Ti)，如果记录的某个版本，XMIN 在 SP(Ti) 中，也应当对 Ti 不可见。

于是，可重复读的判断逻辑如下：

```
(XMIN == Ti and                 // 由 Ti 创建且
 (XMAX == NULL                  // 尚未被删除
))
or                              // 或
(XMIN is commited and           // 由一个已提交的事务创建且
 XMIN < XID and                 // 这个事务小于 Ti 且
 XMIN is not in SP(Ti) and      // 这个事务在 Ti 开始前提交且
 (XMAX == NULL or               // 尚未被删除或
  (XMAX != Ti and               // 由其他事务删除但是
   (XMAX is not commited or     // 这个事务尚未提交或
XMAX > Ti or                    // 这个事务在 Ti 开始之后才开始或
XMAX is in SP(Ti)               // 这个事务在 Ti 开始前还未提交
))))
```

于是，需要提供一个结构，来抽象一个事务，以保存快照数据：

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

构造方法中的 active，保存着当前所有 active 的事务。于是，可重复读的隔离级别下，一个版本是否对事务可见的判断如下：

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