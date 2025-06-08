---
title: MYDB 4. Log Files and Recovery Strategy
lang: en
published: 2021-12-08T22:55:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb4
description: "Within MYDB's design, log files play a crucial role in ensuring smooth recovery after system crashes. Every time the underlying data is manipulated, the DM layer generates and records a log entry, forming a continuous log chain. These logs are stored in a specific binary format containing checksums and various operation records, so that upon system restart, the database can accurately reconstruct its state and maintain data consistency and integrity."
---
The relevant code for this chapter can be found in [backend/dm/logger](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/dm/logger) and [backend/dm/Recover.java](https://github.com/CN-GuoZiyang/MYDB/blob/master/src/main/java/top/guoziyang/mydb/backend/dm/Recover.java).

### Preface

MYDB offers crash recovery capabilities. Every time the DM layer operates on the underlying data, it writes a log entry to disk. After a database crash, upon restarting, MYDB can restore the data files to a consistent state based on the logged content.

### Log Read/Write

Log files are arranged in binary according to the following format:

```
[XChecksum][Log1][Log2][Log3]...[LogN][BadTail]
```

Here, XChecksum is a four-byte integer representing the checksum calculated over all subsequent log records. Log1 through LogN represent the ordinary log data, and BadTail (which may or may not exist) is an incomplete log record left behind by an unexpected database crash.

Each log entry is structured as follows:

```
[Size][Checksum][Data]
```

- Size: A four-byte integer indicating the length (in bytes) of the Data segment.
- Checksum: The checksum for this specific log entry.

The checksum for an individual log entry is calculated using a designated seed value:

```java
private int calChecksum(int xCheck, byte[] log) {
    for (byte b : log) {
        xCheck = xCheck * SEED + b;
    }
    return xCheck;
}
```

By calculating the checksum for each log record and summing them, you obtain the overall log file checksum.

The Logger is implemented as an iterator; calling `next()` continuously reads the next log entry from the file, parses its Data section, and returns it. The `next()` method relies primarily on `internNext()`, which works roughly like this (where position is the current file read offset):

```java
private byte[] internNext() {
    if(position + OF_DATA >= fileSize) {
        return null;
    }
    // Read size
    ByteBuffer tmp = ByteBuffer.allocate(4);
    fc.position(position);
    fc.read(tmp);
    int size = Parser.parseInt(tmp.array());
    if(position + size + OF_DATA > fileSize) {
        return null;
    }

    // Read checksum + data
    ByteBuffer buf = ByteBuffer.allocate(OF_DATA + size);
    fc.position(position);
    fc.read(buf);
    byte[] log = buf.array();

    // Verify checksum
    int checkSum1 = calChecksum(0, Arrays.copyOfRange(log, OF_DATA, log.length));
    int checkSum2 = Parser.parseInt(Arrays.copyOfRange(log, OF_CHECKSUM, OF_DATA));
    if(checkSum1 != checkSum2) {
        return null;
    }
    position += log.length;
    return log;
}
```

When opening a log file, you must first verify the XChecksum and remove any potential BadTail from the file's end. Since BadTail refers to logs that weren’t fully written, their checksum isn’t included in the file checksum, so removing them ensures log file consistency.

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

    // Truncate file to the end of the last valid log
    truncate(position);
    rewind();
}
```

When writing logs to the file, each entry is first wrapped in the proper log format, written to file, and then the overall XChecksum is updated. When updating the checksum, the buffer is flushed to ensure contents actually reach disk.

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

### Recovery Strategy

MYDB borrows its recovery strategy from NYADB2, which, to be honest, is a bit brain-twisting!

The DM layer offers two operations to upper layers:
- Insert new data (I)
- Update existing data (U)

Deletion isn’t discussed here—that’ll be explained in the VM section.

The log protocol adopted by the DM layer can be succinctly described as:

> Before performing an I or U operation, the corresponding log entry **must** be written to disk. Only after the log is securely persisted should the data operation itself proceed.

This approach grants the DM layer much greater freedom regarding data syncing; as long as the log entry arrives on disk prior to the data modification, even if the latter isn’t synced before a crash, the log ensures the operation can always be recovered later.

The DM logs the following for each operation:

- (Ti, I, A, x): Transaction Ti inserted record x at position A.
- (Ti, U, A, oldx, newx): Transaction Ti updated record at position A from oldx to newx.

Let’s ignore concurrency for a moment. At any point in time, only one transaction operates on the database. The logs might look like:

```
(Ti, x, x), ..., (Ti, x, x), (Tj, x, x), ..., (Tj, x, x), (Tk, x, x), ..., (Tk, x, x)
```

#### Single-threaded

Given there’s only one thread, logs from Ti, Tj, and Tk will never intermingle. Recovery here is straightforward: suppose the last transaction in the logs is Ti:

1. Redo (reapply) all log entries for transactions **before** Ti.
2. Check Ti's status (from the XID file):  
    - If Ti is **completed** (committed or aborted), redo its logs as well.
    - If Ti is **active**, undo its logs.

Redoing a transaction T involves:

1. Scanning T's log entries in order.
2. For insert logs (Ti, I, A, x), re-insert x at A.
3. For update logs (Ti, U, A, oldx, newx), set the value at position A to newx.

Undoing T works likewise but in reverse:

1. Scan T’s log entries in reverse order.
2. For insert logs, remove data at A.
3. For update logs, set value at A to oldx.

Note: In MYDB, there is no "real" delete. Undoing an insert simply marks it as invalid. (More on deletes in the VM section.)

#### Multithreaded

The above ensures crash recoverability in the single-threaded case. But what about multiple concurrent transactions? Let’s consider two situations.

**First scenario:**

```
T1 begin
T2 begin
T2 U(x)
T1 R(x)
...
T1 commit
MYDB crash
```

At crash time, T2 is active. On recovery, T2 must be rolled back, nullifying its effect on the database. However, since T1 read data modified by T2, and since T2 has been rolled back, T1 should also be rolled back (cascading rollback). If T1 has already committed, this contradicts the guarantee that the effects of all committed transactions are durable. Thus, we must ensure:

> **Rule 1:** An active transaction must not read data written by any uncommitted transaction.

**Second scenario:** (Let’s say x starts at 0)

```
T1 begin
T2 begin
T1 set x = x+1 // log: (T1, U, A, 0, 1)
T2 set x = x+1 // log: (T2, U, A, 1, 2)
T2 commit
MYDB crash
```

At crash time, T1 is still active. Upon recovery, T1 will be undone, T2 will be redone—but no matter the order of redo/undo, x will end up as either 0 or 2, both of which are wrong.

> The root cause here is an oversimplified logging structure: only "before" and "after" images are recorded; undo/redo depends on these snapshots. Simple log records alone don’t capture the full semantics of transactional database operations.

There are two approaches to handle this:

1. **Enhance log structure**
2. **Restrict database operations**

MYDB opts for the latter: restricts operations such that:

> **Rule 2:** An active transaction must not modify data written/modified by any uncommitted transaction.

Thanks to the VM layer, the actual operation sequence passed down to the DM layer always enforces Rules 1 and 2. Details on how the VM ensures these rules will be covered in its own section (suffice it to say, it’s non-trivial!). With these two constraints, recovery becomes straightforward even under concurrency:

1. **Redo** all completed (committed or aborted) transactions as of the crash.
2. **Undo** all incomplete (active) transactions as of the crash.

After recovery, the database is restored to the state where all completed transactions are persisted, and all in-flight transactions are as if they never started.

#### Implementation

The two log types are defined as:

```java
private static final byte LOG_TYPE_INSERT = 0;
private static final byte LOG_TYPE_UPDATE = 1;

// updateLog:
// [LogType] [XID] [UID] [OldRaw] [NewRaw]

// insertLog:
// [LogType] [XID] [Pgno] [Offset] [Raw]
```

As previously described, the recovery routine involves two passes: redo all completed transactions, then undo all incomplete ones.

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

    // Undo all logs for active transactions in reverse order
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

`updateLog` and `insertLog` are handled by two unified methods for redo/undo:

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

Note that in `doInsertLog()`, logical deletion is implemented by calling `DataItem.setDataItemRawInvalid(li.raw);`. The details of `DataItem` will be covered in the next section—but in short, this simply marks the DataItem as invalid for logical deletion.