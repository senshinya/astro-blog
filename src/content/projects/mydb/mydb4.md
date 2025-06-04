---
title: MYDB 4. 日志文件与恢复策略
published: 2021-12-08T22:55:00+08:00
tags: ["java", "mydb"]
description: "在 MYDB 的设计中，日志文件扮演着至关重要的角色，确保数据在崩溃后能够顺利恢复。每次操作底层数据时，DM 层都会生成并记录日志，形成一条连续的日志链。这些日志以特定的二进制格式存储，包含校验和和各个操作记录，确保在系统重启时能够精准地重建数据状态，维护数据的一致性与完整性。"
---
本章涉及代码都在 [backend/dm/logger](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/dm/logger) 和 [backend/dm/Recover.java](https://github.com/CN-GuoZiyang/MYDB/blob/master/src/main/java/top/guoziyang/mydb/backend/dm/Recover.java) 中。

### 前言

MYDB 提供了崩溃后的数据恢复功能。DM 层在每次对底层数据操作时，都会记录一条日志到磁盘上。在数据库奔溃之后，再次启动时，可以根据日志的内容，恢复数据文件，保证其一致性。

### 日志读写

日志的二进制文件，按照如下的格式进行排布：

```
[XChecksum][Log1][Log2][Log3]...[LogN][BadTail]
```

其中 XChecksum 是一个四字节的整数，是对后续所有日志计算的校验和。Log1 ~ LogN 是常规的日志数据，BadTail 是在数据库崩溃时，没有来得及写完的日志数据，这个 BadTail 不一定存在。

每条日志的格式如下：

```
[Size][Checksum][Data]
```

其中，Size 是一个四字节整数，标识了 Data 段的字节数。Checksum 则是该条日志的校验和。

单条日志的校验和，其实就是通过一个指定的种子实现的：

```java
private int calChecksum(int xCheck, byte[] log) {
    for (byte b : log) {
        xCheck = xCheck * SEED + b;
    }
    return xCheck;
}
```

这样，对所有日志求出校验和，求和就能得到日志文件的校验和了。

Logger 被实现成迭代器模式，通过 `next()` 方法，不断地从文件中读取下一条日志，并将其中的 Data 解析出来并返回。`next()` 方法的实现主要依靠 `internNext()`，大致如下，其中 position 是当前日志文件读到的位置偏移：

```java
private byte[] internNext() {
    if(position + OF_DATA >= fileSize) {
        return null;
    }
    // 读取 size
    ByteBuffer tmp = ByteBuffer.allocate(4);
    fc.position(position);
    fc.read(tmp);
    int size = Parser.parseInt(tmp.array());
    if(position + size + OF_DATA > fileSize) {
        return null;
    }

    // 读取 checksum+data
    ByteBuffer buf = ByteBuffer.allocate(OF_DATA + size);
    fc.position(position);
    fc.read(buf);
    byte[] log = buf.array();

    // 校验 checksum
    int checkSum1 = calChecksum(0, Arrays.copyOfRange(log, OF_DATA, log.length));
    int checkSum2 = Parser.parseInt(Arrays.copyOfRange(log, OF_CHECKSUM, OF_DATA));
    if(checkSum1 != checkSum2) {
        return null;
    }
    position += log.length;
    return log;
}
```

在打开一个日志文件时，需要首先校验日志文件的 XChecksum，并移除文件尾部可能存在的 BadTail，由于 BadTail 该条日志尚未写入完成，文件的校验和也就不会包含该日志的校验和，去掉 BadTail 即可保证日志文件的一致性。

```java
private void checkAndRemoveTail() {
    rewind();

    int xCheck = 0;
    while(true) {
        byte[] log = internNext();
        if(log == null) break;
        xCheck = calChecksum(xCheck, log);
    }
    if(xCheck != xChecksum) {
        Panic.panic(Error.BadLogFileException);
    }

    // 截断文件到正常日志的末尾
    truncate(position);
    rewind();
}
```

向日志文件写入日志时，也是首先将数据包裹成日志格式，写入文件后，再更新文件的校验和，更新校验和时，会刷新缓冲区，保证内容写入磁盘。

```java
public void log(byte[] data) {
    byte[] log = wrapLog(data);
    ByteBuffer buf = ByteBuffer.wrap(log);
    lock.lock();
    try {
        fc.position(fc.size());
        fc.write(buf);
    } catch(IOException e) {
        Panic.panic(e);
    } finally {
        lock.unlock();
    }
    updateXChecksum(log);
}

private void updateXChecksum(byte[] log) {
    this.xChecksum = calChecksum(this.xChecksum, log);
    fc.position(0);
    fc.write(ByteBuffer.wrap(Parser.int2Byte(xChecksum)));
    fc.force(false);
}

private byte[] wrapLog(byte[] data) {
    byte[] checksum = Parser.int2Byte(calChecksum(0, data));
    byte[] size = Parser.int2Byte(data.length);
    return Bytes.concat(size, checksum, data);
}
```

### 恢复策略

恢复策略来自于 NYADB2 的恢复策略，比较烧脑（我感觉）。

DM 为上层模块，提供了两种操作，分别是插入新数据（I）和更新现有数据（U）。至于为啥没有删除数据，这个会在 VM 一节叙述。

DM 的日志策略很简单，一句话就是：

> 在进行 I 和 U 操作之前，必须先进行对应的日志操作，在保证日志写入磁盘后，才进行数据操作。

这个日志策略，使得 DM 对于数据操作的磁盘同步，可以更加随意。日志在数据操作之前，保证到达了磁盘，那么即使该数据操作最后没有来得及同步到磁盘，数据库就发生了崩溃，后续也可以通过磁盘上的日志恢复该数据。

对于两种数据操作，DM 记录的日志如下：

- (Ti, I, A, x)，表示事务 Ti 在 A 位置插入了一条数据 x
- (Ti, U, A, oldx, newx)，表示事务 Ti 将 A 位置的数据，从 oldx 更新成 newx

我们首先不考虑并发的情况，那么在某一时刻，只可能有一个事务在操作数据库。日志会看起来像下面那样：

```
(Ti, x, x), ..., (Ti, x, x), (Tj, x, x), ..., (Tj, x, x), (Tk, x, x), ..., (Tk, x, x)
```

#### 单线程

由于单线程，Ti、Tj 和 Tk 的日志永远不会相交。这种情况下利用日志恢复很简单，假设日志中最后一个事务是 Ti：

1.  对 Ti 之前所有的事务的日志，进行重做（redo）
2.  接着检查 Ti 的状态（XID 文件），如果 Ti 的状态是已完成（包括 committed 和 aborted），就将 Ti 重做，否则进行撤销（undo）

接着，是如何对事务 T 进行 redo：

1.  正序扫描事务 T 的所有日志
2.  如果日志是插入操作 (Ti, I, A, x)，就将 x 重新插入 A 位置
3.  如果日志是更新操作 (Ti, U, A, oldx, newx)，就将 A 位置的值设置为 newx

undo 也很好理解：

1.  倒序扫描事务 T 的所有日志
2.  如果日志是插入操作 (Ti, I, A, x)，就将 A 位置的数据删除
3.  如果日志是更新操作 (Ti, U, A, oldx, newx)，就将 A 位置的值设置为 oldx

注意，MYDB 中其实没有真正的删除操作，对于插入操作的 undo，只是将其中的标志位设置为 invalid。对于删除的探讨将在 VM 一节中进行。

#### 多线程

经过以上的操作，就能保证了 MYDB 在单线程下的恢复性。对于多线程的情况下呢？我们来考虑下面的两种情况。

第一种：

```
T1 begin
T2 begin
T2 U(x)
T1 R(x)
...
T1 commit
MYDB break down
```

在系统崩溃时，T2 仍然是活跃状态。那么当数据库重新启动，执行恢复例程时，会撤销 T2，它对数据库的影响会被消除。但是由于 T1 读取了 T2 更新的值，既然 T2 被撤销，那么 T1 也应当被撤销。这种情况，就是级联回滚。但是，T1 已经 commit 了，所有 commit 的事务的影响，应当被持久化。这里就造成了矛盾。所以这里需要保证：

> 规定 1：正在进行的事务，不会读取其他任何未提交的事务产生的数据。

第二种情况，假设 x 的初值是 0

```
T1 begin
T2 begin
T1 set x = x+1 // 产生的日志为 (T1, U, A, 0, 1)
T2 set x = x+1 // 产生的日志为 (T1, U, A, 1, 2)
T2 commit
MYDB break down
```

在系统崩溃时，T1 仍然是活跃状态。那么当数据库重新启动，执行恢复例程时，会对 T1 进行撤销，对 T2 进行重做，但是，无论撤销和重做的先后顺序如何，x 最后的结果，要么是 0，要么是 2，这都是错误的。

> 出现这种问题的原因，归根结底是因为我们的日志太过简单，仅仅记录了"前相"和"后相". 并单纯的依靠"前相"undo, 依靠"后相"redo. 这种简单的日志方式和恢复方式，并不能涵盖住所有数据库操作形成的语义

解决方法有两种：

1.  增加日志种类
2.  限制数据库操作

MYDB 采用的是限制数据库操作，需要保证：

> 规定 2：正在进行的事务，不会修改其他任何未提交的事务修改或产生的数据。

在 MYDB 中，由于 VM 的存在，传递到 DM 层，真正执行的操作序列，都可以保证规定 1 和规定 2。VM 如何保证这两条规定，会在 VM 层一节中说明（VM 的坑还挺大）。有了这两条规定，并发情况下日志的恢复也就很简单了：

1.  重做所有崩溃时已完成（committed 或 aborted）的事务
2.  撤销所有崩溃时未完成（active）的事务

在恢复后，数据库就会恢复到所有已完成事务结束，所有未完成事务尚未开始的状态。

#### 实现

首先规定两种日志的格式：

```java
private static final byte LOG_TYPE_INSERT = 0;
private static final byte LOG_TYPE_UPDATE = 1;

// updateLog:
// [LogType] [XID] [UID] [OldRaw] [NewRaw]

// insertLog:
// [LogType] [XID] [Pgno] [Offset] [Raw]
```

和原理中描述的类似，recover 例程主要也是两步：重做所有已完成事务，撤销所有未完成事务：

```java
private static void redoTranscations(TransactionManager tm, Logger lg, PageCache pc) {
    lg.rewind();
    while(true) {
        byte[] log = lg.next();
        if(log == null) break;
        if(isInsertLog(log)) {
            InsertLogInfo li = parseInsertLog(log);
            long xid = li.xid;
            if(!tm.isActive(xid)) {
                doInsertLog(pc, log, REDO);
            }
        } else {
            UpdateLogInfo xi = parseUpdateLog(log);
            long xid = xi.xid;
            if(!tm.isActive(xid)) {
                doUpdateLog(pc, log, REDO);
            }
        }
    }
}

private static void undoTranscations(TransactionManager tm, Logger lg, PageCache pc) {
    Map<Long, List<byte[]>> logCache = new HashMap<>();
    lg.rewind();
    while(true) {
        byte[] log = lg.next();
        if(log == null) break;
        if(isInsertLog(log)) {
            InsertLogInfo li = parseInsertLog(log);
            long xid = li.xid;
            if(tm.isActive(xid)) {
                if(!logCache.containsKey(xid)) {
                    logCache.put(xid, new ArrayList<>());
                }
                logCache.get(xid).add(log);
            }
        } else {
            UpdateLogInfo xi = parseUpdateLog(log);
            long xid = xi.xid;
            if(tm.isActive(xid)) {
                if(!logCache.containsKey(xid)) {
                    logCache.put(xid, new ArrayList<>());
                }
                logCache.get(xid).add(log);
            }
        }
    }

    // 对所有 active log 进行倒序 undo
    for(Entry<Long, List<byte[]>> entry : logCache.entrySet()) {
        List<byte[]> logs = entry.getValue();
        for (int i = logs.size()-1; i >= 0; i --) {
            byte[] log = logs.get(i);
            if(isInsertLog(log)) {
                doInsertLog(pc, log, UNDO);
            } else {
                doUpdateLog(pc, log, UNDO);
            }
        }
        tm.abort(entry.getKey());
    }
}
```

updateLog 和 insertLog 的重做和撤销处理，分别合并成一个方法来实现：

```java
private static void doUpdateLog(PageCache pc, byte[] log, int flag) {
    int pgno;
    short offset;
    byte[] raw;
    if(flag == REDO) {
        UpdateLogInfo xi = parseUpdateLog(log);
        pgno = xi.pgno;
        offset = xi.offset;
        raw = xi.newRaw;
    } else {
        UpdateLogInfo xi = parseUpdateLog(log);
        pgno = xi.pgno;
        offset = xi.offset;
        raw = xi.oldRaw;
    }
    Page pg = null;
    try {
        pg = pc.getPage(pgno);
    } catch (Exception e) {
        Panic.panic(e);
    }
    try {
        PageX.recoverUpdate(pg, raw, offset);
    } finally {
        pg.release();
    }
}

private static void doInsertLog(PageCache pc, byte[] log, int flag) {
    InsertLogInfo li = parseInsertLog(log);
    Page pg = null;
    try {
        pg = pc.getPage(li.pgno);
    } catch(Exception e) {
        Panic.panic(e);
    }
    try {
        if(flag == UNDO) {
            DataItem.setDataItemRawInvalid(li.raw);
        }
        PageX.recoverInsert(pg, li.raw, li.offset);
    } finally {
        pg.release();
    }
}
```

注意，`doInsertLog()` 方法中的删除，使用的是 `DataItem.setDataItemRawInvalid(li.raw);`，dataItem 将在下一节中说明，大致的作用，就是将该条 DataItem 的有效位设置为无效，来进行逻辑删除。