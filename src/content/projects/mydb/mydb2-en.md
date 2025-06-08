---
title: MYDB 2. Reference Counting Cache Framework and Shared Memory Arrays
lang: en
published: 2021-11-30T23:18:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb2
description: "The Data Manager (DM) serves as the bridge between upper-level modules and the file system. It is responsible for page and cache management while ensuring data safety and recovery. Notably, for its caching strategy, DM adopts a reference counting framework instead of using the traditional LRU, to improve generality and efficiency and lay the foundation for further data operations."
---
All code covered in this chapter can be found in [backend/common](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/common).

### Preface

Starting from this chapter, we’ll discuss the lowest-level module in MYDB — the Data Manager (DM):

> DM directly manages the Database (DB) file and the log file. Its main responsibilities are: 1) Page management and cache for DB files; 2) Managing log files to ensure recovery in case of errors; 3) Abstracting the DB file as DataItems for upper-level modules and providing caching.

In essence, DM's functionality boils down to two points: it acts as an abstraction layer between the upper modules and the file system, providing file read/write below and data wrapping above; in addition, it offers logging capabilities.

Notice that whether facing upwards (to modules) or downwards (to disk), DM provides caching: using in-memory operations to guarantee efficiency.

### Reference Counting Cache Framework

#### Why not LRU?

Since both page management and DataItem management involve caching, it's worthwhile to design a more general caching framework here.

You may be wondering: Why use a reference counting strategy instead of the seemingly“advanced”LRU approach?

Let’s begin with cache interface design. If we used LRU, all we’d need is a `get(key)` interface, and resources would be automatically evicted from the cache when it's full. But imagine this situation: The cache becomes full and evicts a resource; at that very moment, an upper-level module tries to flush a resource back to the data source—except that resource has just been evicted! The upper-level module now faces an awkward dilemma: should it still attempt the back-write?

1.  Don’t flush. But since you can’t reliably know when the resource was evicted—or whether it was modified after eviction—this approach is unsafe.
2.  Flush anyway. But if the data at eviction and now is unchanged, this becomes a useless write-back.
3.  Reinsert the resource into the cache, wait for the next eviction and flush then. This seems to solve the problem—except the cache is already full, so another resource would have to be evicted, potentially causing cache thrashing.

Sure, we could record each resource’s last modification time, and have the cache track the eviction timestamp. But…

> Entities must not be multiplied beyond necessity. — Occam’s Razor

Ultimately, the root of the issue is that with LRU, eviction is uncontrollable and the upper modules can’t be notified. Reference counting, on the other hand, solves this by ensuring that resources are only evicted from the cache when all modules have released their references.

This defines the reference counting approach: we add a `release(key)` method for upper-level modules to release their resource handles. As soon as the reference count hits zero, the cache can safely evict (and persist) that resource.

On the downside, when the cache is full, reference counting can’t magically free memory—you should simply report an error (much like JVM's OOM).

#### Implementation

`AbstractCache<T>` is an abstract class containing two abstract methods that concrete subclasses must implement:

```java
/**
 * Behavior when a resource is not present in the cache
 */
protected abstract T getForCache(long key) throws Exception;
/**
 * Behavior for writing back a resource when it’s evicted
 */
protected abstract void releaseForCache(T obj);
```

Since we’re using reference counting, we need to maintain an additional counter per resource. To handle multithreading, we also need to record which resources are being loaded from the data source—a potentially time-consuming process. Thus, there are three Maps:

```java
private HashMap<Long, T> cache;                     // Actual cached data
private HashMap<Long, Integer> references;          // Reference counts
private HashMap<Long, Boolean> getting;             // Resources being fetched
```

When retrieving a resource through `get()`, execution enters a loop, repeatedly attempting to access the cache. First, we need to check if another thread is already fetching the resource; if so, we wait a short while and try again:

```java
while(true) {
    lock.lock();
    if(getting.containsKey(key)) {
        // Another thread is fetching this resource
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

If the resource is already cached, just retrieve and return it—don’t forget to increment its reference count. If not, and if the cache isn’t full, register in `getting` that this thread is now responsible for fetching the resource from the data source.

```java
while(true) {
    if(cache.containsKey(key)) {
        // Resource is already cached, return immediately
        T obj = cache.get(key);
        references.put(key, references.get(key) + 1);
        lock.unlock();
        return obj;
    }

    // Attempt to acquire the resource
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

Fetching a resource from the data source is straightforward—just call the abstract getter. When done, remove the key from `getting`.

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

Releasing a cache entry is easier: just decrease the reference count in `references`. If it hits zero, write back the resource, and remove all associated structures from the cache:

```java
/**
 * Forcibly release a cache entry
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

The cache should also have a safe shutdown capability, flushing all resources back when closing.

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

And with that, we have a simple yet robust cache framework! Any other cache simply extends this class and implements the two abstract methods.

### Shared Memory Arrays

Now, here’s a frustrating aspect of Java.

In Java, arrays are objects—stored on the heap like any other object. In languages like C, C++, or Go, arrays are implemented as pointers. That’s why there’s an old saying:

> Only Java has“real”arrays

However, for this project, that's not really good news. For example, in Go you can write:

```go
var array1 [10]int64
array2 := array1[5:]
```

In this scenario, `array2` and the 5th to last elements of `array1` share the same underlying memory—even though the array lengths differ.

This cannot be done in Java (“What does it even mean to be a high-level language?”).

In Java, a subArray operation simply copies data, so the two arrays can never reference the same memory.

To cope, I wrote a SubArray class to (loosely) define a usable range for an array:

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

Honestly, this is an ugly workaround, but it’s the best I could do for now. If anyone has a better solution, please leave a comment below—I really wish there were a more elegant way /(ㄒo ㄒ)/~~