---
title: MYDB 1. 从最简单的 TM 开始
published: 2021-11-28T16:10:00+08:00
tags: ["java", "mydb"]
description: "介绍 MYDB 的事务管理，从 XID 文件及其状态开始。"
---
本章涉及代码都在 [backend/tm](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/tm) 中。

如第 0 章所述：

> TM 通过维护 XID 文件来维护事务的状态，并提供接口供其他模块来查询某个事务的状态。

### XID 文件

下面主要是规则的定义了。

在 MYDB 中，每一个事务都有一个 XID，这个 ID 唯一标识了这个事务。事务的 XID 从 1 开始标号，并自增，不可重复。并特殊规定 XID 0 是一个超级事务（Super Transaction）。当一些操作想在没有申请事务的情况下进行，那么可以将操作的 XID 设置为 0。XID 为 0 的事务的状态永远是 committed。

TransactionManager 维护了一个 XID 格式的文件，用来记录各个事务的状态。MYDB 中，每个事务都有下面的三种状态：

1.  active，正在进行，尚未结束
2.  committed，已提交
3.  aborted，已撤销（回滚）

XID 文件给每个事务分配了一个字节的空间，用来保存其状态。同时，在 XID 文件的头部，还保存了一个 8 字节的数字，记录了这个 XID 文件管理的事务的个数。于是，事务 xid 在文件中的状态就存储在 (xid-1)+8 字节处，xid-1 是因为 xid 0（Super XID） 的状态不需要记录。

TransactionManager 提供了一些接口供其他模块调用，用来创建事务和查询事务状态。更具体的：

```java
public interface TransactionManager {
    long begin();                       // 开启一个新事务
    void commit(long xid);              // 提交一个事务
    void abort(long xid);               // 取消一个事务
    boolean isActive(long xid);         // 查询一个事务的状态是否是正在进行的状态
    boolean isCommitted(long xid);      // 查询一个事务的状态是否是已提交
    boolean isAborted(long xid);        // 查询一个事务的状态是否是已取消
    void close();                       // 关闭TM
}
```

### 实现

规则很简单，剩下的就是编码了。首先定义一些必要的常量：

```java
// XID文件头长度
static final int LEN_XID_HEADER_LENGTH = 8;
// 每个事务的占用长度
private static final int XID_FIELD_SIZE = 1;
// 事务的三种状态
private static final byte FIELD_TRAN_ACTIVE   = 0;
private static final byte FIELD_TRAN_COMMITTED = 1;
private static final byte FIELD_TRAN_ABORTED  = 2;
// 超级事务，永远为commited状态
public static final long SUPER_XID = 0;
// XID 文件后缀
static final String XID_SUFFIX = ".xid";
```

文件读写都采用了 NIO 方式的 FileChannel，读写方式都和传统 IO 的 Input/Output Stream 都有一些区别，不过区别主要是接口方面，熟悉使用即可。

在构造函数创建了一个 TransactionManager 之后，首先要对 XID 文件进行校验，以保证这是一个合法的 XID 文件。校验的方式也很简单，通过文件头的 8 字节数字反推文件的理论长度，与文件的实际长度做对比。如果不同则认为 XID 文件不合法。

```java
private void checkXIDCounter() {
    long fileLen = 0;
    try {
        fileLen = file.length();
    } catch (IOException e1) {
        Panic.panic(Error.BadXIDFileException);
    }
    if(fileLen < LEN_XID_HEADER_LENGTH) {
        Panic.panic(Error.BadXIDFileException);
    }

    ByteBuffer buf = ByteBuffer.allocate(LEN_XID_HEADER_LENGTH);
    try {
        fc.position(0);
        fc.read(buf);
    } catch (IOException e) {
        Panic.panic(e);
    }
    this.xidCounter = Parser.parseLong(buf.array());
    long end = getXidPosition(this.xidCounter + 1);
    if(end != fileLen) {
        Panic.panic(Error.BadXIDFileException);
    }
}
```

对于校验没有通过的，会直接通过 panic 方法，强制停机。在一些基础模块中出现错误都会如此处理，无法恢复的错误只能直接停机。

我们可以先写一个小的方法，用来获取 xid 的状态在文件中的偏移：

```java
// 根据事务xid取得其在xid文件中对应的位置
private long getXidPosition(long xid) {
    return LEN_XID_HEADER_LENGTH + (xid-1)*XID_FIELD_SIZE;
}
```

`begin()` 方法会开始一个事务，更具体的，首先设置 xidCounter+1 事务的状态为 active，随后 xidCounter 自增，并更新文件头。

```java
// 开始一个事务，并返回XID
public long begin() {
    counterLock.lock();
    try {
        long xid = xidCounter + 1;
        updateXID(xid, FIELD_TRAN_ACTIVE);
        incrXIDCounter();
        return xid;
    } finally {
        counterLock.unlock();
    }
}

// 更新xid事务的状态为status
private void updateXID(long xid, byte status) {
    long offset = getXidPosition(xid);
    byte[] tmp = new byte[XID_FIELD_SIZE];
    tmp[0] = status;
    ByteBuffer buf = ByteBuffer.wrap(tmp);
    try {
        fc.position(offset);
        fc.write(buf);
    } catch (IOException e) {
        Panic.panic(e);
    }
    try {
        fc.force(false);
    } catch (IOException e) {
        Panic.panic(e);
    }
}

// 将XID加一，并更新XID Header
private void incrXIDCounter() {
    xidCounter ++;
    ByteBuffer buf = ByteBuffer.wrap(Parser.long2Byte(xidCounter));
    try {
        fc.position(0);
        fc.write(buf);
    } catch (IOException e) {
        Panic.panic(e);
    }
    try {
        fc.force(false);
    } catch (IOException e) {
        Panic.panic(e);
    }
}
```

注意，这里的所有文件操作，在执行后都需要立刻刷入文件中，防止在崩溃后文件丢失数据，fileChannel 的 `force()` 方法，强制同步缓存内容到文件中，类似于 BIO 中的 `flush()` 方法。force 方法的参数是一个布尔，表示是否同步文件的元数据（例如最后修改时间等）。

`commit()` 和 `abort()` 方法就可以直接借助 `updateXID()` 方法实现。

同样，`isActive()`、`isCommitted()` 和 `isAborted()` 都是检查一个 xid 的状态，可以用一个通用的方法解决：

```java
// 检测XID事务是否处于status状态
private boolean checkXID(long xid, byte status) {
    long offset = getXidPosition(xid);
    ByteBuffer buf = ByteBuffer.wrap(new byte[XID_FIELD_SIZE]);
    try {
        fc.position(offset);
        fc.read(buf);
    } catch (IOException e) {
        Panic.panic(e);
    }
    return buf.array()[0] == status;
}
```

当然，检查之间记得排除 SUPER\_XID。

另外就是两个静态方法：`create()` 和 `open()`，分别表示创建一个 xid 文件并创建 TM 和从一个已有的 xid 文件来创建 TM。从零创建 XID 文件时需要写一个空的 XID 文件头，即设置 xidCounter 为 0，否则后续在校验时会不合法：

```java
public static TransactionManagerImpl create(String path) {
    ...
    // 写空XID文件头
    ByteBuffer buf = ByteBuffer.wrap(new byte[TransactionManagerImpl.LEN_XID_HEADER_LENGTH]);
    try {
        fc.position(0);
        fc.write(buf);
    } catch (IOException e) {
        Panic.panic(e);
    }
    ...
}
```

TM 就这么结束了，看起来也没什么难的嘛（￣ c￣）y-～

不着急，真正困难的 DM 还在后面，那可不是一章就能讲完的了~