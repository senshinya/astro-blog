---
title: MYDB 8. インデックス管理
lang: ja
published: 2021-12-24T21:01:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb8
description: "MYDB は B+ 木に基づくクラスタ化インデックスを実装しています。IM（Index Manager）は直接データ管理（DM）とやり取りし、バージョン管理（VM）層を省略することで、インデックスデータを直接データベースファイルに書き込むことを保証しています。本章では二分木インデックスの構造を詳述し、葉フラグ、キー数、兄弟ノード識別子などの基本要素を含むノード構成を解説し、インデックス検索の基盤を提供しています。"
---
本章で扱うコードはすべて [backend/im](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/im) にあります。

### はじめに

IM（Index Manager）は MYDB における B+ 木に基づくクラスタ化インデックス管理者です。現状、MYDB はインデックスによるデータ検索のみをサポートし、全表スキャンはサポートしていません。興味のある方はご自身で実装してみてください。

依存関係図を見ると、IM は DM に直接依存しており、VM を介していません。インデックスデータはバージョン管理を経ずに直接データベースファイルに挿入されます。

本節では B+ 木アルゴリズムの詳細は省略し、実装面に焦点を当てます。

### 二分木インデックス

二分木は複数の Node から構成され、各 Node は一つの DataItem に格納されます。構造は以下の通りです：

```
[LeafFlag][KeyNumber][SiblingUid]
[Son0][Key0][Son1][Key1]...[SonN][KeyN]
```

ここで LeafFlag はノードが葉かどうかを示し、KeyNumber はノード内のキー数、SiblingUid は兄弟ノードの DM 内での UID を示します。その後に子ノード（SonN）とキー（KeyN）が交互に並びます。最後の KeyN は常に MAX_VALUE であり、検索を容易にしています。

Node クラスは自身の B+ 木構造への参照、DataItem への参照、SubArray への参照を持ち、データの迅速な修正と解放を可能にしています。

```java
public class Node {
    BPlusTree tree;
    DataItem dataItem;
    SubArray raw;
    long uid;
    ...
}
```

このようにして根ノードのデータを生成するコードは以下の通りです：

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

この根ノードは初期の二つの子ノード left と right を持ち、初期キーは key です。

同様に、空の根ノードデータを生成するコードは以下の通りです：

```java
static byte[] newNilRootRaw()  {
    SubArray raw = new SubArray(new byte[NODE_SIZE], 0, NODE_SIZE);
    setRawIsLeaf(raw, true);
    setRawNoKeys(raw, 0);
    setRawSibling(raw, 0);
    return raw.raw;
}
```

Node クラスには B+ 木の挿入と検索操作を補助する二つのメソッド、searchNext と leafSearchRange があります。

searchNext は指定したキーに対応する UID を探し、見つからなければ兄弟ノードの UID を返します。

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

leafSearchRange は現在のノード内で \[leftKey, rightKey\] の範囲検索を行います。rightKey がノード内の最大キー以上の場合、兄弟ノードの UID も返し、次のノードの検索を容易にしています。

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

B+ 木は挿入や削除時に動的に調整されるため、根ノードは固定されません。そのため、bootDataItem という DataItem に根ノードの UID を保存しています。IM が DM を操作する際、使用するトランザクションはすべて SUPER_XID です。

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

IM は上位モジュールに対して主に二つの機能を提供します：インデックスの挿入とノードの検索です。B+ 木への挿入および検索アルゴリズムの詳細な実装はここでは省略します。

ここで疑問に思うかもしれませんが、なぜ IM はインデックスの削除機能を提供しないのでしょうか。上位モジュールが VM を通じてあるエントリを削除する際、実際にはその XMAX を設定します。対応するインデックスを削除しなければ、後でそのエントリを再度読み込もうとした場合、インデックスで見つかりますが、XMAX が設定されているため適切なバージョンが見つからず、内容が見つからないエラーが返されます。

### 起こりうるエラーと復旧

B+ 木の操作中に発生しうるエラーは二種類あります。ノード内部のエラーとノード間の関係エラーです。

ノード内部のエラーは、Ti がノードのデータを変更中に MYDB がクラッシュした場合に発生します。IM は DM に依存しているため、データベース再起動時に Ti はロールバック（undo）され、ノードの不整合は解消されます。

ノード間のエラーが発生した場合は以下のような状況です：ある u ノードへの挿入操作で新しいノード v が作成され、sibling(u) = v となっていますが、v が親ノードに挿入されていません。

```
[parent]
    
    v
   [u] -> [v]
```

正しい状態は以下の通りです：

```
[ parent ]
       
 v      v
[u] -> [v]
```

この場合、ノードの挿入や検索操作が失敗しても、兄弟ノードを順に辿ることで最終的に v ノードを見つけることができます。唯一の欠点は、親ノードから直接 v に辿り着けず、u を経由して間接的に v にアクセスする必要があることです。

今日は 12 月 25 日、クリスマスです。メリークリスマス！