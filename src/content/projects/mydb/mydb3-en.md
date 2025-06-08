---
title: MYDB 3. Caching and Management of Data Pages
lang: en
published: 2021-12-05T15:28:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb3
description: "The DM module abstracts the file system as pages, using them as units for data reads, writes, and caching. By default, each data page is 8K in size, which helps to improve write performance under heavy loads. With a general-purpose caching framework already in place, the next step is to define the specific structure of a page for efficient page cache management."
---
All relevant code for this chapter can be found in [backend/dm/pageCache](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/dm/pageCache) and [backend/dm/page](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/dm/page).

### Preface

This section is primarily concerned with how the DM (Data Manager) module abstracts the underlying file system. DM treats the file system as a collection of fixed-size pages, with every read and write operation being performed at the granularity of a page. Similarly, data fetched from disk is cached in memory on a per-page basis.

### Page Cache

Following the design patterns of most databases, the default page size is set to 8K. If you want to further boost write performance for large-volume data inserts, you can increase this size accordingly.

In the previous section, we implemented a general-purpose caching framework. Now, to cache pages, we can simply leverage that framework. However, the first step is to define the structure of a page. Note that this "page" exists in memory and is conceptually different from the abstract page that is already persisted to disk.

A page can be defined as follows:

```java
public class PageImpl implements Page {
    private int pageNumber;
    private byte[] data;
    private boolean dirty;
    private Lock lock;

    private PageCache pc;
}
```

Here, `pageNumber` is the identifier for the page, **which starts from 1**. `data` holds the actual byte content of the page. `dirty` marks whether the page has been modified; if it's a dirty page, it must be written back to disk when evicted from the cache. The class also maintains a reference to a `PageCache`, allowing quick release of page resources when holding a reference to a `Page`.

The page cache interface is defined as follows:

```java
public interface PageCache {
    int newPage(byte[] initData);
    Page getPage(int pgno) throws Exception;
    void close();
    void release(Page page);

    void truncateByBgno(int maxPgno);
    int getPageNumber();
    void flushPage(Page pg);
}
```

To implement `PageCache`, you need to inherit from the abstract cache framework and implement the two abstract methods: `getForCache()` and `releaseForCache()`. Since the data source is the file system, `getForCache()` simply reads data from the file and wraps it in a `Page`:

```java
@Override
protected Page getForCache(long key) throws Exception {
    int pgno = (int)key;
    long offset = PageCacheImpl.pageOffset(pgno);

    ByteBuffer buf = ByteBuffer.allocate(PAGE_SIZE);
    fileLock.lock();
    try {
        fc.position(offset);
        fc.read(buf);
    } catch(IOException e) {
        Panic.panic(e);
    }
    fileLock.unlock();
    return new PageImpl(pgno, buf.array(), this);
}

private static long pageOffset(int pgno) {
    // Page numbers start from 1
    return (pgno-1) * PAGE_SIZE;
}
```

When evicting a page with `releaseForCache()`, you only need to check if it’s dirty; if so, write it back to disk:

```java
@Override
protected void releaseForCache(Page pg) {
    if(pg.isDirty()) {
        flush(pg);
        pg.setDirty(false);
    }
}

private void flush(Page pg) {
    int pgno = pg.getPageNumber();
    long offset = pageOffset(pgno);

    fileLock.lock();
    try {
        ByteBuffer buf = ByteBuffer.wrap(pg.getData());
        fc.position(offset);
        fc.write(buf);
        fc.force(false);
    } catch(IOException e) {
        Panic.panic(e);
    } finally {
        fileLock.unlock();
    }
}
```

`PageCache` also uses an `AtomicInteger` to keep track of the number of pages currently open in the database file. This count is calculated when the database file is first opened and incremented whenever a new page is created.

```java
public int newPage(byte[] initData) {
    int pgno = pageNumbers.incrementAndGet();
    Page pg = new PageImpl(pgno, initData, null);
    flush(pg);  // Newly created pages must be flushed to disk immediately
    return pgno;
}
```

One important point: a single data entry is **not** allowed to span pages. This restriction will become more evident in later chapters, but it means the maximum size of a single data item cannot exceed the page size of the database.

### Data Page Management

#### The First Page

The first page of the database file is usually reserved for special purposes such as storing metadata or for startup checks. In MYDB, the first page is used for startup verification. Specifically, each time the database starts, a random byte string is generated and stored in bytes 100 to 107. When the database shuts down gracefully, this string is copied to bytes 108 to 115 of the first page.

On the next startup, the database compares the two byte sequences in the first page. If they match, the previous shutdown was clean; if not, it means the previous session ended abnormally and recovery is required.

Setting the random bytes at startup:

```java
public static void setVcOpen(Page pg) {
    pg.setDirty(true);
    setVcOpen(pg.getData());
}

private static void setVcOpen(byte[] raw) {
    System.arraycopy(RandomUtil.randomBytes(LEN_VC), 0, raw, OF_VC, LEN_VC);
}
```

Copying the bytes at shutdown:

```java
public static void setVcClose(Page pg) {
    pg.setDirty(true);
    setVcClose(pg.getData());
}

private static void setVcClose(byte[] raw) {
    System.arraycopy(raw, OF_VC, raw, OF_VC+LEN_VC, LEN_VC);
}
```

Verifying the bytes:

```java
public static boolean checkVc(Page pg) {
    return checkVc(pg.getData());
}

private static boolean checkVc(byte[] raw) {
    return Arrays.equals(Arrays.copyOfRange(raw, OF_VC, OF_VC+LEN_VC), Arrays.copyOfRange(raw, OF_VC+LEN_VC, OF_VC+2*LEN_VC));
}
```

*Note: The `Arrays.compare()` method is not compatible with JDK 8; you can replace it with any equivalent approach.*

#### Regular Data Pages

MYDB handles regular data pages in a straightforward way. Each page begins with a two-byte unsigned integer indicating the offset of the free space (FSO) in the page. The rest of the page is used for actual data storage.

Thus, managing a regular page is mainly about manipulating the FSO. For example, inserting data into a page is done as follows:

```java
// Insert raw data into pg and return the insertion offset
public static short insert(Page pg, byte[] raw) {
    pg.setDirty(true);
    short offset = getFSO(pg.getData());
    System.arraycopy(raw, 0, pg.getData(), offset, raw.length);
    setFSO(pg.getData(), (short)(offset + raw.length));
    return offset;
}
```

You obtain the FSO before writing to determine where to insert the data, and update the FSO afterwards. FSO manipulation functions are as follows:

```java
private static void setFSO(byte[] raw, short ofData) {
    System.arraycopy(Parser.short2Byte(ofData), 0, raw, OF_FREE, OF_DATA);
}

// Get the FSO of pg
public static short getFSO(Page pg) {
    return getFSO(pg.getData());
}

private static short getFSO(byte[] raw) {
    return Parser.parseShort(Arrays.copyOfRange(raw, 0, 2));
}

// Get the free space size in the page
public static int getFreeSpace(Page pg) {
    return PageCache.PAGE_SIZE - (int)getFSO(pg.getData());
}
```

Two remaining functions, `recoverInsert()` and `recoverUpdate()`, are used in recovery routines to restore data directly into pages after a database crash:

```java
// Insert raw data into pg at the specified offset, and update the FSO if necessary
public static void recoverInsert(Page pg, byte[] raw, short offset) {
    pg.setDirty(true);
    System.arraycopy(raw, 0, pg.getData(), offset, raw.length);

    short rawFSO = getFSO(pg.getData());
    if(rawFSO < offset + raw.length) {
        setFSO(pg.getData(), (short)(offset+raw.length));
    }
}

// Insert raw data into pg at the specified offset without updating FSO
public static void recoverUpdate(Page pg, byte[] raw, short offset) {
    pg.setDirty(true);
    System.arraycopy(raw, 0, pg.getData(), offset, raw.length);
}
```