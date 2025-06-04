---
title: MYDB 8. 索引管理
published: 2021-12-24T21:01:00+08:00
tags: ["java", "mydb"]
description: "MYDB 基于 B+ 树实现了聚簇索引。通过 IM 直接与数据管理（DM）交互，省略了版本管理（VM）层，确保索引数据直接写入数据库文件。章节中详细描述了二叉树索引的结构，涵盖节点的基本组成元素，包括叶子标记、键数量及兄弟节点标识等，为实现索引查找提供了基础框架。"
---
本章涉及代码都在 [backend/im](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/im) 中。

### 前言

IM，即 Index Manager，索引管理器，为 MYDB 提供了基于 B+ 树的聚簇索引。目前 MYDB 只支持基于索引查找数据，不支持全表扫描。感兴趣的同学可以自行实现。

在依赖关系图中可以看到，IM 直接基于 DM，而没有基于 VM。索引的数据被直接插入数据库文件中，而不需要经过版本管理。

本节不赘述 B+ 树算法，更多描述实现。

### 二叉树索引

二叉树由一个个 Node 组成，每个 Node 都存储在一条 DataItem 中。结构如下：

```
[LeafFlag][KeyNumber][SiblingUid]
[Son0][Key0][Son1][Key1]...[SonN][KeyN]
```

其中 LeafFlag 标记了该节点是否是个叶子节点；KeyNumber 为该节点中 key 的个数；SiblingUid 是其兄弟节点存储在 DM 中的 UID。后续是穿插的子节点（SonN）和 KeyN。最后的一个 KeyN 始终为 MAX\_VALUE，以此方便查找。

Node 类持有了其 B+ 树结构的引用，DataItem 的引用和 SubArray 的引用，用于方便快速修改数据和释放数据。

```java
public class Node {
    BPlusTree tree;
    DataItem dataItem;
    SubArray raw;
    long uid;
    ...
}
```

于是生成一个根节点的数据可以写成如下：

```java
static byte[] newRootRaw(long left, long right, long key)  {
    SubArray raw = new SubArray(new byte[NODE_SIZE], 0, NODE_SIZE);
    setRawIsLeaf(raw, false);
    setRawNoKeys(raw, 2);
    setRawSibling(raw, 0);
    setRawKthSon(raw, left, 0);
    setRawKthKey(raw, key, 0);
    setRawKthSon(raw, right, 1);
    setRawKthKey(raw, Long.MAX_VALUE, 1);
    return raw.raw;
}
```

该根节点的初始两个子节点为 left 和 right, 初始键值为 key。

类似的，生成一个空的根节点数据：

```java
static byte[] newNilRootRaw()  {
    SubArray raw = new SubArray(new byte[NODE_SIZE], 0, NODE_SIZE);
    setRawIsLeaf(raw, true);
    setRawNoKeys(raw, 0);
    setRawSibling(raw, 0);
    return raw.raw;
}
```

Node 类有两个方法，用于辅助 B+ 树做插入和搜索操作，分别是 searchNext 方法和 leafSearchRange 方法。

searchNext 寻找对应 key 的 UID, 如果找不到, 则返回兄弟节点的 UID。

```java
public SearchNextRes searchNext(long key) {
    dataItem.rLock();
    try {
        SearchNextRes res = new SearchNextRes();
        int noKeys = getRawNoKeys(raw);
        for(int i = 0; i < noKeys; i ++) {
            long ik = getRawKthKey(raw, i);
            if(key < ik) {
                res.uid = getRawKthSon(raw, i);
                res.siblingUid = 0;
                return res;
            }
        }
        res.uid = 0;
        res.siblingUid = getRawSibling(raw);
        return res;
    } finally {
        dataItem.rUnLock();
    }
}
```

leafSearchRange 方法在当前节点进行范围查找，范围是 \[leftKey, rightKey\]，这里约定如果 rightKey 大于等于该节点的最大的 key, 则还同时返回兄弟节点的 UID，方便继续搜索下一个节点。

```java
public LeafSearchRangeRes leafSearchRange(long leftKey, long rightKey) {
    dataItem.rLock();
    try {
        int noKeys = getRawNoKeys(raw);
        int kth = 0;
        while(kth < noKeys) {
            long ik = getRawKthKey(raw, kth);
            if(ik >= leftKey) {
                break;
            }
            kth ++;
        }
        List<Long> uids = new ArrayList<>();
        while(kth < noKeys) {
            long ik = getRawKthKey(raw, kth);
            if(ik <= rightKey) {
                uids.add(getRawKthSon(raw, kth));
                kth ++;
            } else {
                break;
            }
        }
        long siblingUid = 0;
        if(kth == noKeys) {
            siblingUid = getRawSibling(raw);
        }
        LeafSearchRangeRes res = new LeafSearchRangeRes();
        res.uids = uids;
        res.siblingUid = siblingUid;
        return res;
    } finally {
        dataItem.rUnLock();
    }
}
```

由于 B+ 树在插入删除时，会动态调整，根节点不是固定节点，于是设置一个 bootDataItem，该 DataItem 中存储了根节点的 UID。可以注意到，IM 在操作 DM 时，使用的事务都是 SUPER\_XID。

```java
public class BPlusTree {
    DataItem bootDataItem;

    private long rootUid() {
        bootLock.lock();
        try {
            SubArray sa = bootDataItem.data();
            return Parser.parseLong(Arrays.copyOfRange(sa.raw, sa.start, sa.start+8));
        } finally {
            bootLock.unlock();
        }
    }

    private void updateRootUid(long left, long right, long rightKey) throws Exception {
        bootLock.lock();
        try {
            byte[] rootRaw = Node.newRootRaw(left, right, rightKey);
            long newRootUid = dm.insert(TransactionManagerImpl.SUPER_XID, rootRaw);
            bootDataItem.before();
            SubArray diRaw = bootDataItem.data();
            System.arraycopy(Parser.long2Byte(newRootUid), 0, diRaw.raw, diRaw.start, 8);
            bootDataItem.after(TransactionManagerImpl.SUPER_XID);
        } finally {
            bootLock.unlock();
        }
    }
}
```

IM 对上层模块主要提供两种能力：插入索引和搜索节点。向 B+ 树插入节点和搜索节点的算法和实现，不再赘述。

这里可能会有疑问，IM 为什么不提供删除索引的能力。当上层模块通过 VM 删除某个 Entry，实际的操作是设置其 XMAX。如果不去删除对应索引的话，当后续再次尝试读取该 Entry 时，是可以通过索引寻找到的，但是由于设置了 XMAX，寻找不到合适的版本而返回一个找不到内容的错误。

### 可能的错误与恢复

B+ 树在操作过程中，可能出现两种错误，分别是节点内部错误和节点间关系错误。

当节点内部错误发生时，即当 Ti 在对节点的数据进行更改时，MYDB 发生了崩溃。由于 IM 依赖于 DM，在数据库重启后，Ti 会被撤销（undo），对节点的错误影响会被消除。

如果出现了节点间错误，那么一定是下面这种情况：某次对 u 节点的插入操作创建了新节点 v, 此时 sibling(u)=v，但是 v 却并没有被插入到父节点中。

```
[parent]
    
    v
   [u] -> [v]
```

正确的状态应当如下：

```
[ parent ]
       
 v      v
[u] -> [v]
```

这时，如果要对节点进行插入或者搜索操作，如果失败，就会继续迭代它的兄弟节点，最终还是可以找到 v 节点。唯一的缺点仅仅是，无法直接通过父节点找到 v 了，只能间接地通过 u 获取到 v。

今天是 12 月 25 日，圣诞节。Happy Xmas！