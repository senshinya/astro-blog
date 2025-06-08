---
title: MYDB 1. 最もシンプルな TM から始める
lang: ja
published: 2021-11-28T16:10:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb1
description: "MYDB では、トランザクションの管理は XID ファイルによって実現されており、各トランザクションには 1 から始まる一意の XID が割り当てられています。XID 0 はスーパートランザクションとして定義され、その状態は常にコミット済みです。TransactionManager はこのファイルを管理し、トランザクションの三つの状態（アクティブ、コミット済み、中止）を記録します。この仕組みにより、トランザクションの状態を正確に照会・管理でき、システムの安定性と信頼性の基盤を提供しています。"
---
本章で扱うコードはすべて [backend/tm](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/tm) にあります。

第0章で述べたように：

> TM は XID ファイルを維持することでトランザクションの状態を管理し、他のモジュールが特定のトランザクションの状態を照会できるインターフェースを提供します。

### XID ファイル

以下は主にルールの定義です。

MYDB では、各トランザクションに XID が割り当てられ、この ID がトランザクションを一意に識別します。トランザクションの XID は 1 から始まり、インクリメントされて重複しません。特別に XID 0 はスーパートランザクション（Super Transaction）と定められています。トランザクションを開始せずに操作を行いたい場合、その操作の XID を 0 に設定できます。XID 0 のトランザクションの状態は常にコミット済みです。

TransactionManager は XID 形式のファイルを管理し、各トランザクションの状態を記録します。MYDB におけるトランザクションの状態は以下の三つです：

1. active（アクティブ）: 実行中でまだ終了していない状態
2. committed（コミット済み）: コミットが完了した状態
3. aborted（中止）: ロールバックされた状態

XID ファイルは各トランザクションに 1 バイトの領域を割り当て、その状態を保存します。また、XID ファイルのヘッダーには 8 バイトの数値が保存されており、このファイルが管理するトランザクション数を記録しています。したがって、トランザクションの xid の状態はファイルの (xid-1)+8 バイト目に格納されます。xid-1 とするのは、xid 0（Super XID）の状態は記録不要だからです。

TransactionManager は他のモジュールが呼び出せるインターフェースを提供し、トランザクションの生成や状態照会を可能にしています。具体的には：

```java
public interface TransactionManager {
    long begin();                       // 新しいトランザクションを開始
    void commit(long xid);              // トランザクションをコミット
    void abort(long xid);               // トランザクションを中止
    boolean isActive(long xid);         // トランザクションがアクティブか照会
    boolean isCommitted(long xid);      // トランザクションがコミット済みか照会
    boolean isAborted(long xid);        // トランザクションが中止か照会
    void close();                       // TM を閉じる
}
```

### 実装

ルールは非常にシンプルで、あとはコーディングするだけです。まず必要な定数を定義します：

```java
// XID ファイルヘッダーの長さ
static final int LEN_XID_HEADER_LENGTH = 8;
// 各トランザクションが占める長さ
private static final int XID_FIELD_SIZE = 1;
// トランザクションの三つの状態
private static final byte FIELD_TRAN_ACTIVE   = 0;
private static final byte FIELD_TRAN_COMMITTED = 1;
private static final byte FIELD_TRAN_ABORTED  = 2;
// スーパートランザクション、常にコミット済み状態
public static final long SUPER_XID = 0;
// XID ファイルの拡張子
static final String XID_SUFFIX = ".xid";
```

ファイルの読み書きは NIO の FileChannel を用いて行います。読み書き方法は従来の IO の Input/Output Stream と多少異なりますが、主にインターフェースの違いであり、慣れれば問題ありません。

TransactionManager のコンストラクタで生成後、まず XID ファイルの検証を行い、正当な XID ファイルであることを保証します。検証方法は簡単で、ファイルヘッダーの 8 バイトの数値から理論的なファイル長を逆算し、実際のファイル長と比較します。異なれば不正な XID ファイルと判断します。

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

検証に失敗した場合は panic メソッドで強制的に停止します。基盤モジュールでの致命的なエラーはこのように処理し、復旧不能な場合は即座に停止させます。

まずは xid の状態がファイル内のどこにあるかを取得する小さなメソッドを書きます：

```java
// トランザクション xid に対応する xid ファイル内の位置を取得
private long getXidPosition(long xid) {
    return LEN_XID_HEADER_LENGTH + (xid-1)*XID_FIELD_SIZE;
}
```

`begin()` メソッドはトランザクションを開始します。具体的には、xidCounter+1 のトランザクションの状態を active に設定し、xidCounter をインクリメントし、ファイルヘッダーを更新します。

```java
// トランザクションを開始し、XID を返す
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

// xid トランザクションの状態を status に更新
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

// XID をインクリメントし、XID ヘッダーを更新
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

ここでのすべてのファイル操作は、実行後すぐにファイルに書き込む必要があります。これはクラッシュ時のデータ損失を防ぐためです。FileChannel の `force()` メソッドはキャッシュ内容を強制的にファイルに同期し、BIO の `flush()` に似ています。force の引数はファイルのメタデータ（最終更新日時など）も同期するかどうかを示すブール値です。

`commit()` と `abort()` メソッドは `updateXID()` を利用して簡単に実装できます。

また、`isActive()`、`isCommitted()`、`isAborted()` は xid の状態をチェックするもので、共通のメソッドで実装可能です：

```java
// XID トランザクションが status 状態かチェック
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

もちろん、チェック時には SUPER\_XID を除外することを忘れないでください。

さらに、静的メソッド `create()` と `open()` があります。前者は新規に xid ファイルを作成して TM を生成し、後者は既存の xid ファイルから TM を生成します。新規作成時は空の XID ファイルヘッダー（xidCounter = 0）を書き込む必要があります。そうしないと後の検証で不正と判断されます：

```java
public static TransactionManagerImpl create(String path) {
    ...
    // 空の XID ファイルヘッダーを書き込む
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

これで TM は完成です。見た目ほど難しくありませんね（￣ c￣）y-～

焦らずに、真の難関である DM はまだ先にあります。あれは一章で語り尽くせるものではありませんからね〜