---
title: MYDB 1. Starting from the Simplest TM
lang: en
published: 2021-11-28T16:10:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb1
description: "In MYDB, transaction management is implemented through the XID file, with each transaction being uniquely identified by an incrementally assigned XID, starting from 1. XID 0 is defined as the Super Transaction, whose state is always committed. The TransactionManager is responsible for maintaining this file and recording the three states of a transaction: active, committed, and aborted. This mechanism ensures that the status of transactions can be accurately queried and managed, providing a foundation for system stability and reliability."
---
All code referenced in this chapter can be found in [backend/tm](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/tm).

As described in Chapter 0:

> TM maintains transaction states by managing the XID file and provides interfaces for other modules to query the state of a specific transaction.

### The XID File

Let's start by defining the rules.

In MYDB, each transaction is assigned a unique XID, which serves as its identifier. XIDs start from 1 and increment automatically with each transaction; there are no duplicates. By convention, XID 0 is reserved for the Super Transaction. If some operations need to proceed without an actual transaction, they can do so using XID 0, whose state is always "committed."

TransactionManager keeps a file in XID format to record the state of all transactions. Every transaction in MYDB can be in one of the following three states:

1.  active — ongoing, not yet finished
2.  committed — finished and committed
3.  aborted — canceled (rolled back)

The XID file allocates one byte per transaction to store its state. In addition, the file header contains an 8-byte number that records how many transactions are managed by this XID file. Therefore, the state of the transaction with id `xid` is stored at byte offset `(xid-1) + 8` in the file; the “xid-1” part is because there’s no need to record the state of XID 0 (the Super Transaction).

TransactionManager provides several interfaces for other modules to interact with: to create transactions, and to check the state of a transaction. Specifically:

```java
public interface TransactionManager {
    long begin();                       // Start a new transaction
    void commit(long xid);              // Commit a transaction
    void abort(long xid);               // Abort a transaction
    boolean isActive(long xid);         // Is the transaction currently active?
    boolean isCommitted(long xid);      // Has the transaction been committed?
    boolean isAborted(long xid);        // Has the transaction been aborted?
    void close();                       // Close the TM
}
```

### Implementation

The rules are simple — all that's left is the coding. Let's define the necessary constants first:

```java
// Length of XID file header
static final int LEN_XID_HEADER_LENGTH = 8;
// Each transaction uses 1 byte to store state
private static final int XID_FIELD_SIZE = 1;
// Transaction states
private static final byte FIELD_TRAN_ACTIVE   = 0;
private static final byte FIELD_TRAN_COMMITTED = 1;
private static final byte FIELD_TRAN_ABORTED  = 2;
// Super Transaction, always committed
public static final long SUPER_XID = 0;
// XID file suffix
static final String XID_SUFFIX = ".xid";
```

We use NIO’s FileChannel for file I/O, which is a bit different from traditional IO’s Input/Output Streams, mainly at the API level — get familiar and you’ll be fine.

When constructing a TransactionManager, the first thing to do is validate the XID file to ensure it's a legitimate XID file. Validation is straightforward: use the 8-byte header to deduce the expected file length and compare with the actual file length. If they don't match, the file is invalid.

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

If validation fails, the panic method is called, which halts the program. Such fatal errors in core modules are not recoverable and should always halt the system.

Let's write a quick helper method to get the file offset for a given xid:

```java
// Get the file offset for the state of a transaction
private long getXidPosition(long xid) {
    return LEN_XID_HEADER_LENGTH + (xid-1)*XID_FIELD_SIZE;
}
```

The `begin()` method starts a new transaction: it sets the state for the transaction `(xidCounter + 1)` to "active", then increments xidCounter and updates the file header.

```java
// Start a new transaction, return its XID
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

// Update transaction status for xid
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

// Increment XID counter and update XID header
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

Note: All file operations must be flushed to disk immediately after execution. This prevents data loss in case of a crash. The FileChannel’s `force()` method flushes changes to disk — it’s similar to calling `flush()` in traditional BIO. The boolean parameter indicates whether file metadata (such as the last modified time) should also be synced.

The `commit()` and `abort()` methods can simply use `updateXID()`.

Similarly, `isActive()`, `isCommitted()`, and `isAborted()` all check a transaction's state. We can write a generic check method:

```java
// Check if a transaction is in a specific state
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

Of course, checks for SUPER_XID (0) should be handled separately.

Finally, there are two static methods: `create()` and `open()` — for creating a new XID file (and new TM), or opening an existing file (and TM). When creating an XID file from scratch, remember to write an empty header (set xidCounter to 0), otherwise validation will fail:

```java
public static TransactionManagerImpl create(String path) {
    ...
    // Write an empty XID file header
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

And that's it — the TM is complete! Looks pretty easy, right? (￣ c￣)y-～

No rush — the truly challenging DM chapter is up next, and trust me, it won’t be wrapped up in just one post~