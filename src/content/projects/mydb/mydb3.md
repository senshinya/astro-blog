---
title: MYDB 3. 数据页的缓存与管理
published: 2021-12-05T15:28:00+08:00
tags: ["java", "mydb"]
description: "DM 模块将文件系统抽象为页面，并以此为单位进行数据的读写和缓存。默认设置的数据页大小为8K，便于在高负载情况下提升写入性能。借助已实现的通用缓存框架，接下来将专注于具体定义页面结构，以实现高效的页面缓存管理。"
---
本章涉及代码都在 [backend/dm/pageCache](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/dm/pageCache) 和 [backend/dm/page](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/dm/page) 中。

### 前言

本节主要内容就是 DM 模块向下对文件系统的抽象部分。DM 将文件系统抽象成页面，每次对文件系统的读写都是以页面为单位的。同样，从文件系统读进来的数据也是以页面为单位进行缓存的。

### 页面缓存

这里参考大部分数据库的设计，将默认数据页大小定为 8K。如果想要提升向数据库写入大量数据情况下的性能的话，也可以适当增大这个值。

上一节我们已经实现了一个通用的缓存框架，那么这一节我们需要缓存页面，就可以直接借用那个缓存的框架了。但是首先，需要定义出页面的结构。注意这个页面是存储在内存中的，与已经持久化到磁盘的抽象页面有区别。

定义一个页面如下：

```java
public class PageImpl implements Page {
    private int pageNumber;
    private byte[] data;
    private boolean dirty;
    private Lock lock;

    private PageCache pc;
}
```

其中，pageNumber 是这个页面的页号，**该页号从 1 开始**。data 就是这个页实际包含的字节数据。dirty 标志着这个页面是否是脏页面，在缓存驱逐的时候，脏页面需要被写回磁盘。这里保存了一个 PageCache（还未定义）的引用，用来方便在拿到 Page 的引用时可以快速对这个页面的缓存进行释放操作。

定义页面缓存的接口如下：

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

页面缓存的具体实现类，需要继承抽象缓存框架，并且实现 `getForCache()` 和 `releaseForCache()` 两个抽象方法。由于数据源就是文件系统，`getForCache()` 直接从文件中读取，并包裹成 Page 即可：

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
    // 页号从 1 开始
    return (pgno-1) * PAGE_SIZE;
}
```

而 `releaseForCache()` 驱逐页面时，也只需要根据页面是否是脏页面，来决定是否需要写回文件系统：

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

PageCache 还使用了一个 AtomicInteger，来记录了当前打开的数据库文件有多少页。这个数字在数据库文件被打开时就会被计算，并在新建页面时自增。

```java
public int newPage(byte[] initData) {
    int pgno = pageNumbers.incrementAndGet();
    Page pg = new PageImpl(pgno, initData, null);
    flush(pg);  // 新建的页面需要立刻写回
    return pgno;
}
```

提一点，同一条数据是不允许跨页存储的，这一点会从后面的章节中体现。这意味着，单条数据的大小不能超过数据库页面的大小。

### 数据页管理

#### 第一页

数据库文件的第一页，通常用作一些特殊用途，比如存储一些元数据，用来启动检查什么的。MYDB 的第一页，只是用来做启动检查。具体的原理是，在每次数据库启动时，会生成一串随机字节，存储在 100 ~ 107 字节。在数据库正常关闭时，会将这串字节，拷贝到第一页的 108 ~ 115 字节。

这样数据库在每次启动时，就会检查第一页两处的字节是否相同，以此来判断上一次是否正常关闭。如果是异常关闭，就需要执行数据的恢复流程。

启动时设置初始字节：

```java
public static void setVcOpen(Page pg) {
    pg.setDirty(true);
    setVcOpen(pg.getData());
}

private static void setVcOpen(byte[] raw) {
    System.arraycopy(RandomUtil.randomBytes(LEN_VC), 0, raw, OF_VC, LEN_VC);
}
```

关闭时拷贝字节：

```java
public static void setVcClose(Page pg) {
    pg.setDirty(true);
    setVcClose(pg.getData());
}

private static void setVcClose(byte[] raw) {
    System.arraycopy(raw, OF_VC, raw, OF_VC+LEN_VC, LEN_VC);
}
```

校验字节：

```java
public static boolean checkVc(Page pg) {
    return checkVc(pg.getData());
}

private static boolean checkVc(byte[] raw) {
    return Arrays.equals(Arrays.copyOfRange(raw, OF_VC, OF_VC+LEN_VC), Arrays.copyOfRange(raw, OF_VC+LEN_VC, OF_VC+2*LEN_VC));
}
```

似乎就是这个 `Arrays.compare()` 方法不兼容 JDK8，可以使用其他等价的方法替换。

#### 普通页

MYDB 对于普通数据页的管理就比较简单了。一个普通页面以一个 2 字节无符号数起始，表示这一页的空闲位置的偏移。剩下的部分都是实际存储的数据。

所以对普通页的管理，基本都是围绕着对 FSO（Free Space Offset）进行的。例如向页面插入数据：

```java
// 将raw插入pg中，返回插入位置
public static short insert(Page pg, byte[] raw) {
    pg.setDirty(true);
    short offset = getFSO(pg.getData());
    System.arraycopy(raw, 0, pg.getData(), offset, raw.length);
    setFSO(pg.getData(), (short)(offset + raw.length));
    return offset;
}
```

在写入之前获取 FSO，来确定写入的位置，并在写入之后更新 FSO。FSO 的操作如下：

```java
private static void setFSO(byte[] raw, short ofData) {
    System.arraycopy(Parser.short2Byte(ofData), 0, raw, OF_FREE, OF_DATA);
}

// 获取pg的FSO
public static short getFSO(Page pg) {
    return getFSO(pg.getData());
}

private static short getFSO(byte[] raw) {
    return Parser.parseShort(Arrays.copyOfRange(raw, 0, 2));
}

// 获取页面的空闲空间大小
public static int getFreeSpace(Page pg) {
    return PageCache.PAGE_SIZE - (int)getFSO(pg.getData());
}
```

剩余两个函数 `recoverInsert()` 和 `recoverUpdate()` 用于在数据库崩溃后重新打开时，恢复例程直接插入数据以及修改数据使用。

```java
// 将raw插入pg中的offset位置，并将pg的offset设置为较大的offset
public static void recoverInsert(Page pg, byte[] raw, short offset) {
    pg.setDirty(true);
    System.arraycopy(raw, 0, pg.getData(), offset, raw.length);

    short rawFSO = getFSO(pg.getData());
    if(rawFSO < offset + raw.length) {
        setFSO(pg.getData(), (short)(offset+raw.length));
    }
}

// 将raw插入pg中的offset位置，不更新update
public static void recoverUpdate(Page pg, byte[] raw, short offset) {
    pg.setDirty(true);
    System.arraycopy(raw, 0, pg.getData(), offset, raw.length);
}
```