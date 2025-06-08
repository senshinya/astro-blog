---
title: MYDB 8. Index Management
lang: en
published: 2021-12-24T21:01:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb8
description: "MYDB implements clustered indexes based on B+ trees. The Index Manager (IM) interacts directly with Data Management (DM), bypassing the Version Manager (VM) layer to ensure index data is directly written to the database file. This section details the structure of the binary tree index, covering the basic elements of a node—leaf marker, key count, and sibling node identifier, etc.—providing the foundational framework for implementing index search."
---
All code discussed in this chapter can be found in [backend/im](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/im).

### Preface

IM, or Index Manager, provides MYDB with a clustered index built on a B+ tree. Currently, MYDB only supports index-based data lookup and does not support full table scans. If you're interested, you can try implementing this on your own.

As shown in the dependency diagram, IM is built directly upon DM and does not depend on VM. Index data is written directly into the database file, without passing through version management.

This section won’t go into detail on B+ tree algorithms; instead, it focuses on implementation aspects.

### Binary Tree Index

The binary tree consists of individual Nodes, each stored within a DataItem. The structure is as follows:

```
[LeafFlag][KeyNumber][SiblingUid]
[Son0][Key0][Son1][Key1]...[SonN][KeyN]
```

- `LeafFlag` marks whether the node is a leaf.
- `KeyNumber` indicates the number of keys in this node.
- `SiblingUid` is the UID of its sibling node as stored in DM.
- What follows are alternating child node UIDs (`SonN`) and keys (`KeyN`). 
- The last key (`KeyN`) is always set to `MAX_VALUE` to simplify search logic.

The `Node` class maintains references to its B+ tree, the `DataItem`, and a `SubArray`, allowing efficient data modification and release.

```java
public class Node {
    BPlusTree tree;
    DataItem dataItem;
    SubArray raw;
    long uid;
    ...
}
```

Thus, creating the data for a root node might look like this:

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

Here, the root node’s two initial children are `left` and `right`, and its initial key is `key`.

Similarly, to create an empty root node:

```java
static byte[] newNilRootRaw()  {
    SubArray raw = new SubArray(new byte[NODE_SIZE], 0, NODE_SIZE);
    setRawIsLeaf(raw, true);
    setRawNoKeys(raw, 0);
    setRawSibling(raw, 0);
    return raw.raw;
}
```

The `Node` class provides two methods to facilitate B+ tree insert and search operations: `searchNext` and `leafSearchRange`.

The `searchNext` method finds the UID corresponding to a given key; if not found, it returns the sibling node’s UID.

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

The `leafSearchRange` method searches for a key range \[leftKey, rightKey\] within the current node. By convention, if `rightKey` is greater than or equal to the node's largest key, the sibling node's UID is also returned, so searching can continue in the next node.

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

Because the B+ tree may be dynamically adjusted (e.g., upon insert and delete), the root node is not static. Instead, a `bootDataItem` is set up to hold the root node UID. Note that when IM interacts with DM, it always uses the `SUPER_XID` transaction.

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

IM provides two major capabilities to higher-level modules: inserting indexes and searching nodes. The actual algorithms and implementation for inserting into and searching the B+ tree will not be elaborated upon here.

You might wonder: why doesn’t IM provide an operation to delete an index? When a higher-level module uses VM to delete an Entry, it actually sets its XMAX. If we do not delete the corresponding index, subsequent attempts to read the Entry can still find it via the index. However, due to the XMAX setting, no valid version will be found and a “not found” error will be returned.

### Possible Errors and Recovery

Two types of errors may occur during B+ tree operations: node internal errors, and errors in the relationships between nodes.

For internal node errors (e.g., if the database crashes while a transaction Ti is modifying a node), since IM relies on DM, any changes made by Ti will be undone upon database restart, so the incorrect modification is discarded.

As for relationship errors between nodes, consider this scenario: inserting into node `u` creates a new node `v`, and now `sibling(u) = v`. However, `v` has not yet been inserted into the parent node.

```
[parent]
    
    v
   [u] -> [v]
```

The correct state should look like this:

```
[ parent ]
       
 v      v
[u] -> [v]
```

If node insert or search operations are attempted at this point, and fail for `u`, the operation will proceed to its sibling node, eventually finding node `v`. The only drawback is that the parent cannot locate `v` directly and can only reach it via `u`.

Today is December 25th—Christmas Day. Happy Xmas!