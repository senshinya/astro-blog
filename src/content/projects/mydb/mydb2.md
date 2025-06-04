---
title: MYDB 2. 引用计数缓存框架和共享内存数组
published: 2021-11-30T23:18:00+08:00
tags: ["java", "mydb"]
description: "本章介绍 MYDB 的数据管理模块，重点讨论引用计数缓存框架和共享内存数组。"
---
本章涉及代码都在 [backend/common](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/common) 中。

### 前言

从这一章中，我们开始讨论 MYDB 中最底层的模块 —— Data Manager：

> DM 直接管理数据库 DB 文件和日志文件。DM 的主要职责有：1) 分页管理 DB 文件，并进行缓存；2) 管理日志文件，保证在发生错误时可以根据日志进行恢复；3) 抽象 DB 文件为 DataItem 供上层模块使用，并提供缓存。

DM 的功能其实可以归纳为两点：上层模块和文件系统之间的一个抽象层，向下直接读写文件，向上提供数据的包装；另外就是日志功能。

可以注意到，无论是向上还是向下，DM 都提供了一个缓存的功能，用内存操作来保证效率。

### 引用计数缓存框架

#### why not LRU?

由于分页管理和数据项（DataItem）管理都涉及缓存，这里设计一个更通用的缓存框架。

看到这里，估计你们也开始犯嘀咕了，为啥使用引用计数策略，而不使用 “极为先进的” LRU 策略呢？

这里首先从缓存的接口设计说起，如果使用 LRU 缓存，那么只需要设计一个 `get(key)` 接口即可，释放缓存可以在缓存满了之后自动完成。设想这样一个场景：某个时刻缓存满了，缓存驱逐了一个资源，这时上层模块想要将某个资源强制刷回数据源，这个资源恰好是刚刚被驱逐的资源。那么上层模块就发现，这个数据在缓存里消失了，这时候就陷入了一种尴尬的境地：是否有必要做回源操作？

1.  不回源。由于没法确定缓存被驱逐的时间，更没法确定被驱逐之后数据项是否被修改，这样是极其不安全的
2.  回源。如果数据项被驱逐时的数据和现在又是相同的，那就是一次无效回源
3.  放回缓存里，等下次被驱逐时回源。看起来解决了问题，但是此时缓存已经满了，这意味着你还需要驱逐一个资源才能放进去。这有可能会导致缓存抖动问题

当然我们可以记录下资源的最后修改时间，并且让缓存记录下资源被驱逐的时间。但是……

> 如无必要，无增实体。 —— 奥卡姆剃刀

问题的根源还是，LRU 策略中，资源驱逐不可控，上层模块无法感知。而引用计数策略正好解决了这个问题，只有上层模块主动释放引用，缓存在确保没有模块在使用这个资源了，才会去驱逐资源。

这就是引用计数法了。增加了一个方法 `release(key)`，用于在上册模块不使用某个资源时，释放对资源的引用。当引用归零时，缓存就会驱逐这个资源。

同样，在缓存满了之后，引用计数法无法自动释放缓存，此时应该直接报错（和 JVM 似的，直接 OOM）

#### 实现

`AbstractCache<T>` 是一个抽象类，内部有两个抽象方法，留给实现类去实现具体的操作：

```java
/**
 * 当资源不在缓存时的获取行为
 */
protected abstract T getForCache(long key) throws Exception;
/**
 * 当资源被驱逐时的写回行为
 */
protected abstract void releaseForCache(T obj);
```

引用计数嘛，除了普通的缓存功能，还需要另外维护一个计数。除此以外，为了应对多线程场景，还需要记录哪些资源正在从数据源获取中（从数据源获取资源是一个相对费时的操作）。于是有下面三个 Map：

```java
private HashMap<Long, T> cache;                     // 实际缓存的数据
private HashMap<Long, Integer> references;          // 资源的引用个数
private HashMap<Long, Boolean> getting;             // 正在被获取的资源
```

于是，在通过 get() 方法获取资源时，首先进入一个死循环，来无限尝试从缓存里获取。首先就需要检查这个时候是否有其他线程正在从数据源获取这个资源，如果有，就过会再来看看（

```java
while(true) {
    lock.lock();
    if(getting.containsKey(key)) {
        // 请求的资源正在被其他线程获取
        lock.unlock();
        try {
            Thread.sleep(1);
        } catch (InterruptedException e) {
            e.printStackTrace();
            continue;
        }
        continue;
    }
    ...
}
```

当然如果资源在缓存中，就可以直接获取并返回了，记得要给资源的引用数 +1。否则，如果缓存没满的话，就在 getting 中注册一下，该线程准备从数据源获取资源了。

```java
while(true) {
    if(cache.containsKey(key)) {
        // 资源在缓存中，直接返回
        T obj = cache.get(key);
        references.put(key, references.get(key) + 1);
        lock.unlock();
        return obj;
    }

    // 尝试获取该资源
    if(maxResource > 0 && count == maxResource) {
        lock.unlock();
        throw Error.CacheFullException;
    }
    count ++;
    getting.put(key, true);
    lock.unlock();
    break;
}
```

从数据源获取资源就比较简单了，直接调用那个抽象方法即可，获取完成记得从 getting 中删除 key。

```java
T obj = null;
try {
    obj = getForCache(key);
} catch(Exception e) {
    lock.lock();
    count --;
    getting.remove(key);
    lock.unlock();
    throw e;
}

lock.lock();
getting.remove(key);
cache.put(key, obj);
references.put(key, 1);
lock.unlock();
```

释放一个缓存就简单多了，直接从 references 中减 1，如果已经减到 0 了，就可以回源，并且删除缓存中所有相关的结构了：

```java
/**
 * 强行释放一个缓存
 */
protected void release(long key) {
    lock.lock();
    try {
        int ref = references.get(key)-1;
        if(ref == 0) {
            T obj = cache.get(key);
            releaseForCache(obj);
            references.remove(key);
            cache.remove(key);
            count --;
        } else {
            references.put(key, ref);
        }
    } finally {
        lock.unlock();
    }
}
```

缓存应当还有以一个安全关闭的功能，在关闭时，需要将缓存中所有的资源强行回源。

```java
lock.lock();
try {
    Set<Long> keys = cache.keySet();
    for (long key : keys) {
        release(key);
        references.remove(key);
        cache.remove(key);
    }
} finally {
    lock.unlock();
}
```

这样，一个简单的缓存框架就实现完了，其他的缓存只需要继承这个类，并实现那两个抽象方法即可。

### 共享内存数组

这里得提一个 Java 很蛋疼的地方。

Java 中，将数组看作一个对象，在内存中，也是以对象的形式存储的。而 c、cpp 和 go 之类的语言，数组是用指针来实现的。这就是为什么有一种说法：

> 只有 Java 有真正的数组

但这对这个项目似乎不是一个好消息。譬如 golang，可以执行下面语句：

```go
var array1 [10]int64
array2 := array1[5:]
```

这种情况下，array2 和 array1 的第五个元素到最后一个元素，是共用同一片内存的，即使这两个数组的长度不同。

这在 Java 中是无法实现的（什么是高级语言啊~）。

在 Java 中，当你执行类似 subArray 的操作时，只会在底层进行一个复制，无法同一片内存。

于是，我写了一个 SubArray 类，来（松散地）规定这个数组的可使用范围：

```java
public class SubArray {
    public byte[] raw;
    public int start;
    public int end;

    public SubArray(byte[] raw, int start, int end) {
        this.raw = raw;
        this.start = start;
        this.end = end;
    }
}
```

说实话，这是一个很丑的方案，但是暂时也只能这样了。如果有其他解决方案的同学，可以在底下留言，我也不想写得这么丑/(ㄒoㄒ)/~~