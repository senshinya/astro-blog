---
title: MYDB 5. Page Index and DM Implementation
lang: en
published: 2021-12-11T15:16:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb5
description: "The page index is a crucial component of the DM (Data Manager) layer, optimizing insert operations by caching each page’s free space. This mechanism allows upper-layer modules to quickly locate suitable pages, avoiding lengthy search processes and improving data processing efficiency. In terms of implementation, the page index is closely tied to the DataItem abstraction, providing strong support for efficient database operations."
---
All code files discussed in this chapter can be found in [backend/dm/pageIndex](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/dm/pageIndex), [backend/dm/dataItem](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/dm/dataItem), and [backend/dm](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/dm).

### Preface

This section wraps up the DM layer by introducing a simple page indexing mechanism. It also explains the abstraction of DataItem, through which DM exposes functionality to upper layers.

### Page Index

The page index caches the free space available on each page, enabling fast discovery of a suitable page when an upper layer needs to insert data. This avoids scanning every page from disk or cache.

MYDB uses a coarse-grained algorithm: it divides each page’s available space into 40 intervals. On startup, it scans all pages, determines how much free space each has, and assigns them to one of the 40 intervals. When an insert requires a page, the required space is rounded up and mapped to an interval. Any page in the chosen interval will suffice.

The implementation of PageIndex is straightforward—a List array:

```java
public class PageIndex {
    // Divide one page into 40 intervals
    private static final int INTERVALS_NO = 40;
    private static final int THRESHOLD = PageCache.PAGE_SIZE / INTERVALS_NO;

    private List[] lists;
}
```

Selecting a page from the PageIndex is also simple: calculate the interval, fetch a page from it:

```java
public PageInfo select(int spaceSize) {
    int number = spaceSize / THRESHOLD;
    if(number < INTERVALS_NO) number ++;
    while(number <= INTERVALS_NO) {
        if(lists[number].size() == 0) {
            number ++;
            continue;
        }
        return lists[number].remove(0);
    }
    return null;
}
```

A returned `PageInfo` contains the page number and its free space.

Note that a selected page is immediately removed from the index, ensuring no concurrent writes to the same page. Once the upper layer is done with the page, it should be reinserted into the PageIndex:

```java
public void add(int pgno, int freeSpace) {
    int number = freeSpace / THRESHOLD;
    lists[number].add(new PageInfo(pgno, freeSpace));
}
```

When a DataManager instance is created, it must scan all pages and populate the PageIndex:

```java
// Initialize pageIndex
void fillPageIndex() {
    int pageNumber = pc.getPageNumber();
    for(int i = 2; i <= pageNumber; i ++) {
        Page pg = null;
        try {
            pg = pc.getPage(i);
        } catch (Exception e) {
            Panic.panic(e);
        }
        pIndex.add(pg.getPageNumber(), PageX.getFreeSpace(pg));
        pg.release();
    }
}
```

Be sure to release the Page promptly after use to avoid exhausting the cache.

### DataItem

`DataItem` is the abstraction the DM layer exposes to upper-layer modules. Upper layers provide an address and DM returns the corresponding DataItem, from which data can then be obtained.

The DataItem implementation is straightforward:

```java
public class DataItemImpl implements DataItem {
    private SubArray raw;
    private byte[] oldRaw;
    private DataManagerImpl dm;
    private long uid;
    private Page pg;
}
```

A reference to `dm` is maintained because releasing a DataItem depends on the DM (which also implements the cache for DataItems), as well as for logging changes during modification.

The internal format of a DataItem is:

```
[ValidFlag] [DataSize] [Data]
```

Here, ValidFlag is 1 byte, indicating whether the DataItem is valid. Deleting simply involves setting the valid bit to 0. DataSize occupies 2 bytes and records the length of the data that follows.

After acquiring a DataItem, the upper layer can access the data using the `data()` method, which returns a shared (not copied) array using SubArray:

```java
@Override
public SubArray data() {
    return new SubArray(raw.raw, raw.start+OF_DATA, raw.end);
}
```

Before a DataItem can be modified, upper layers need to follow a specific protocol: call `before()` before modification, `unBefore()` to roll back, and `after()` when finished. This process preserves the pre-modification image and logs changes in a timely manner, ensuring atomic updates.

```java
@Override
public void before() {
    wLock.lock();
    pg.setDirty(true);
    System.arraycopy(raw.raw, raw.start, oldRaw, 0, oldRaw.length);
}

@Override
public void unBefore() {
    System.arraycopy(oldRaw, 0, raw.raw, raw.start, oldRaw.length);
    wLock.unlock();
}

@Override
public void after(long xid) {
    dm.logDataItem(xid, this);
    wLock.unlock();
}
```

The `after()` simply calls a logging method in DM and is straightforward.

Once a DataItem is no longer in use, be sure to call `release()` so its cache entry (maintained by DM) can be released.

```java
@Override
public void release() {
    dm.releaseDataItem(this);
}
```

### DataManager Implementation

The DataManager is the class providing DM-layer operations to upper layers and acts as a cache for DataItem objects. The key for each DataItem is an 8-byte unsigned integer composed of a 4-byte page number and 4-byte offset within the page.

To fetch a DataItem from the cache—`getForCache()`—simply parse the key to get the page number, retrieve the page from the pager cache, and then get the DataItem by its offset:

```java
@Override
protected DataItem getForCache(long uid) throws Exception {
    short offset = (short)(uid & ((1L << 16) - 1));
    uid >>>= 32;
    int pgno = (int)(uid & ((1L << 32) - 1));
    Page pg = pc.getPage(pgno);
    return DataItem.parseDataItem(pg, offset, this);
}
```

To release a cached DataItem, flush it to the data source. Since file IO is performed per-page, simply releasing the page suffices:

```java
@Override
protected void releaseForCache(DataItem di) {
    di.page().release();
}
```

The workflows for creating a DataManager from an existing file and from a new file differ slightly. Aside from creating PageCache and Logger, initializing from a new file requires initializing the first page; starting from an existing file means verifying and potentially recovering the first page. In both cases, the first page is assigned fresh random bytes.

```java
public static DataManager create(String path, long mem, TransactionManager tm) {
    PageCache pc = PageCache.create(path, mem);
    Logger lg = Logger.create(path);
    DataManagerImpl dm = new DataManagerImpl(pc, lg, tm);
    dm.initPageOne();
    return dm;
}

public static DataManager open(String path, long mem, TransactionManager tm) {
    PageCache pc = PageCache.open(path, mem);
    Logger lg = Logger.open(path);
    DataManagerImpl dm = new DataManagerImpl(pc, lg, tm);
    if(!dm.loadCheckPageOne()) {
        Recover.recover(tm, lg, pc);
    }
    dm.fillPageIndex();
    PageOne.setVcOpen(dm.pageOne);
    dm.pc.flushPage(dm.pageOne);
    return dm;
}
```

Initializing or verifying the first page is largely handled by PageOne:

```java
// Initialize PageOne when creating a new file
void initPageOne() {
    int pgno = pc.newPage(PageOne.InitRaw());
    assert pgno == 1;
    try {
        pageOne = pc.getPage(pgno);
    } catch (Exception e) {
        Panic.panic(e);
    }
    pc.flushPage(pageOne);
}

// Load and check PageOne when opening an existing file
boolean loadCheckPageOne() {
    try {
        pageOne = pc.getPage(1);
    } catch (Exception e) {
        Panic.panic(e);
    }
    return PageOne.checkVc(pageOne);
}
```

The DM layer offers three major functionalities to upper layers: read, insert, and modify. Modifications are performed via DataItem, so DataManager only needs to provide `read()` and `insert()` methods.

`read()` fetches a DataItem via UID and validates the 'valid' flag:

```java
@Override
public DataItem read(long uid) throws Exception {
    DataItemImpl di = (DataItemImpl)super.get(uid);
    if(!di.isValid()) {
        di.release();
        return null;
    }
    return di;
}
```

The `insert()` method allocates a page from `pageIndex` with enough free space, writes the insert log, then performs the actual data insertion via PageX, and returns the insert offset. The page is then re-added to the index.

```java
@Override
public long insert(long xid, byte[] data) throws Exception {
    byte[] raw = DataItem.wrapDataItemRaw(data);
    if(raw.length > PageX.MAX_FREE_SPACE) {
        throw Error.DataTooLargeException;
    }

    // Try to acquire an available page
    PageInfo pi = null;
    for(int i = 0; i < 5; i ++) {
        pi = pIndex.select(raw.length);
        if (pi != null) {
            break;
        } else {
            int newPgno = pc.newPage(PageX.initRaw());
            pIndex.add(newPgno, PageX.MAX_FREE_SPACE);
        }
    }
    if(pi == null) {
        throw Error.DatabaseBusyException;
    }

    Page pg = null;
    int freeSpace = 0;
    try {
        pg = pc.getPage(pi.pgno);
        // Log the operation first
        byte[] log = Recover.insertLog(xid, pg, raw);
        logger.log(log);
        // Then perform the insert
        short offset = PageX.insert(pg, raw);

        pg.release();
        return Types.addressToUid(pi.pgno, offset);

    } finally {
        // Re-insert the page info into pIndex
        if(pg != null) {
            pIndex.add(pi.pgno, PageX.getFreeSpace(pg));
        } else {
            pIndex.add(pi.pgno, freeSpace);
        }
    }
}
```

On normal DataManager shutdown, remember to close the cache and logger, and set the check bytes for the first page:

```java
@Override
public void close() {
    super.close();
    logger.close();

    PageOne.setVcClose(pageOne);
    pageOne.release();
    pc.close();
}
```

That concludes the DM layer.

Today is December 11, 2021—the first anniversary live stream for A-SOUL. Happy first anniversary, A-SOUL! Here’s to the second, third, and even tenth anniversaries! See you at the Beijing National Stadium!!!

![](https://blog-img.shinya.click/2025/bee2e73291a2ecde2667bb41f2e2c5b6.jpg)

We are, ASOUL!