---
title: MYDB 3. データページのキャッシュと管理
lang: ja
published: 2021-12-05T15:28:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb3
description: "DMモジュールはファイルシステムをページ単位に抽象化し、その単位でデータの読み書きとキャッシュを行います。デフォルトのデータページサイズは8Kに設定されており、高負荷時の書き込み性能向上に寄与します。既に実装済みの汎用キャッシュフレームワークを活用し、次にページ構造の具体的な定義に注力し、高効率なページキャッシュ管理を実現します。"
---

本章で扱うコードは [backend/dm/pageCache](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/dm/pageCache) と [backend/dm/page](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/dm/page) にあります。

### はじめに

本節の主な内容は、DMモジュールがファイルシステムをどのように抽象化しているかという部分です。DMはファイルシステムをページ単位に抽象化し、ファイルシステムへの読み書きは常にページ単位で行います。同様に、ファイルシステムから読み込んだデータもページ単位でキャッシュされます。

### ページキャッシュ

ここでは多くのデータベース設計を参考にし、デフォルトのデータページサイズを8Kに設定しています。大量のデータを書き込む場合、性能向上のためにこの値を適宜大きくすることも可能です。

前節で汎用キャッシュフレームワークを実装済みなので、今回はページをキャッシュするためにそのフレームワークをそのまま利用できます。ただし、まずページの構造を定義する必要があります。ここでのページはメモリ上に存在し、ディスクに永続化された抽象ページとは異なる点に注意してください。

ページの定義は以下の通りです：

```java
public class PageImpl implements Page {
    private int pageNumber;
    private byte[] data;
    private boolean dirty;
    private Lock lock;

    private PageCache pc;
}
```

ここで、pageNumberはページ番号で、**1から始まります**。dataはページが実際に保持するバイトデータです。dirtyはこのページがダーティページ（変更されているページ）かどうかを示し、キャッシュの追い出し時にダーティページはディスクに書き戻されます。PageCache（まだ定義していません）の参照も保持しており、Pageの参照を取得した際に素早くキャッシュ解放操作を行うために使います。

ページキャッシュのインターフェースは以下のように定義します：

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

ページキャッシュの具体的な実装クラスは抽象キャッシュフレームワークを継承し、`getForCache()` と `releaseForCache()` の2つの抽象メソッドを実装する必要があります。データソースはファイルシステムなので、`getForCache()` はファイルから直接読み込み、Pageに包んで返せば良いです：

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
    // ページ番号は1から始まる
    return (pgno-1) * PAGE_SIZE;
}
```

一方、`releaseForCache()` はページを追い出す際に、ダーティページかどうかでファイルシステムへの書き戻しが必要かを判断します：

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

PageCacheはまた、AtomicIntegerを使って現在開いているデータベースファイルのページ数を管理しています。この数値はデータベースファイルを開いたときに計算され、新規ページ作成時にインクリメントされます。

```java
public int newPage(byte[] initData) {
    int pgno = pageNumbers.incrementAndGet();
    Page pg = new PageImpl(pgno, initData, null);
    flush(pg);  // 新規ページは即座に書き戻す必要がある
    return pgno;
}
```

一点補足すると、同一データがページを跨いで格納されることは許されません。これは後の章で明らかになります。つまり、単一データのサイズはデータベースページサイズを超えてはならないということです。

### データページ管理

#### 第1ページ

データベースファイルの第1ページは、通常特別な用途に使われます。例えばメタデータの保存や起動時のチェックなどです。MYDBの第1ページは起動チェックのためだけに使われています。具体的には、データベース起動時にランダムなバイト列を生成し、100〜107バイト目に保存します。正常終了時にはこのバイト列を第1ページの108〜115バイト目にコピーします。

こうして、起動時に第1ページの2箇所のバイト列が一致するかを確認し、前回の正常終了か異常終了かを判定します。異常終了の場合はデータ復旧処理を実行します。

起動時の初期バイト設定：

```java
public static void setVcOpen(Page pg) {
    pg.setDirty(true);
    setVcOpen(pg.getData());
}

private static void setVcOpen(byte[] raw) {
    System.arraycopy(RandomUtil.randomBytes(LEN_VC), 0, raw, OF_VC, LEN_VC);
}
```

終了時のバイトコピー：

```java
public static void setVcClose(Page pg) {
    pg.setDirty(true);
    setVcClose(pg.getData());
}

private static void setVcClose(byte[] raw) {
    System.arraycopy(raw, OF_VC, raw, OF_VC+LEN_VC, LEN_VC);
}
```

バイト列の検証：

```java
public static boolean checkVc(Page pg) {
    return checkVc(pg.getData());
}

private static boolean checkVc(byte[] raw) {
    return Arrays.equals(Arrays.copyOfRange(raw, OF_VC, OF_VC+LEN_VC), Arrays.copyOfRange(raw, OF_VC+LEN_VC, OF_VC+2*LEN_VC));
}
```

どうやらこの `Arrays.compare()` メソッドはJDK8と互換性がないようなので、他の同等の方法に置き換えることが推奨されます。

#### 通常ページ

MYDBの通常データページ管理は比較的シンプルです。通常ページは2バイトの符号なし整数で始まり、これはページ内の空き位置のオフセットを示します。残りの部分は実際のデータ保存領域です。

したがって、通常ページの管理は主にFSO（Free Space Offset）を中心に行われます。例えばページにデータを挿入する場合：

```java
// rawをpgに挿入し、挿入位置を返す
public static short insert(Page pg, byte[] raw) {
    pg.setDirty(true);
    short offset = getFSO(pg.getData());
    System.arraycopy(raw, 0, pg.getData(), offset, raw.length);
    setFSO(pg.getData(), (short)(offset + raw.length));
    return offset;
}
```

書き込み前にFSOを取得して書き込み位置を決定し、書き込み後にFSOを更新します。FSOの操作は以下の通りです：

```java
private static void setFSO(byte[] raw, short ofData) {
    System.arraycopy(Parser.short2Byte(ofData), 0, raw, OF_FREE, OF_DATA);
}

// pgのFSOを取得
public static short getFSO(Page pg) {
    return getFSO(pg.getData());
}

private static short getFSO(byte[] raw) {
    return Parser.parseShort(Arrays.copyOfRange(raw, 0, 2));
}

// ページの空き容量を取得
public static int getFreeSpace(Page pg) {
    return PageCache.PAGE_SIZE - (int)getFSO(pg.getData());
}
```

残りの2つの関数 `recoverInsert()` と `recoverUpdate()` は、データベースクラッシュ後の再起動時に、復旧処理で直接データ挿入や更新を行うために使われます。

```java
// rawをpgのoffset位置に挿入し、pgのFSOを大きい方に設定
public static void recoverInsert(Page pg, byte[] raw, short offset) {
    pg.setDirty(true);
    System.arraycopy(raw, 0, pg.getData(), offset, raw.length);

    short rawFSO = getFSO(pg.getData());
    if(rawFSO < offset + raw.length) {
        setFSO(pg.getData(), (short)(offset+raw.length));
    }
}

// rawをpgのoffset位置に挿入、FSOは更新しない
public static void recoverUpdate(Page pg, byte[] raw, short offset) {
    pg.setDirty(true);
    System.arraycopy(raw, 0, pg.getData(), offset, raw.length);
}
```