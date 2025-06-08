---
title: MYDB 5. ページインデックスとDMの実装
lang: ja
published: 2021-12-11T15:16:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb5
description: "ページインデックスはDM層の重要な構成要素であり、各ページの空きスペースをキャッシュすることで挿入操作を最適化します。この仕組みにより上位モジュールは適切なページを迅速に特定でき、長い検索過程を避けてデータ処理の効率を向上させます。実装面では、ページインデックスはデータ項目（DataItem）の抽象と密接に結びつき、データベースの高効率な運用を支えています。"
---
本章で扱うコードはすべて [backend/dm/pageIndex](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/dm/pageIndex)、[backend/dm/dataItem](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/dm/dataItem)、および [backend/dm](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/dm) にあります。

### はじめに

本節ではDM層の締めくくりとして、シンプルなページインデックスの実装を紹介します。また、DM層が上位に提供する抽象であるDataItemの実装も行います。

### ページインデックス

ページインデックスは各ページの空きスペースをキャッシュしています。これにより、上位モジュールが挿入操作を行う際に、ディスクやキャッシュからすべてのページ情報を調べることなく、適切な空きスペースを持つページを素早く見つけることが可能です。

MYDBでは比較的粗いアルゴリズムでページインデックスを実装しており、1ページの空間を40の区間に分割しています。起動時にすべてのページ情報を走査し、ページの空きスペースを取得してこれら40区間に振り分けます。挿入時は要求された空きスペースを切り上げて該当区間にマッピングし、その区間の任意のページを取り出せば要件を満たします。

PageIndexの実装も非常にシンプルで、List型の配列として表現されています。

```java
public class PageIndex {
    // 1ページを40区間に分割
    private static final int INTERVALS_NO = 40;
    private static final int THRESHOLD = PageCache.PAGE_SIZE / INTERVALS_NO;

    private List[] lists;
}
```

PageIndexからページを取得するのも簡単で、区間番号を計算して直接取得します：

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

返されるPageInfoにはページ番号と空きスペースの大きさが含まれます。

選択されたページはPageIndexから直接削除されるため、同一ページへの同時書き込みは許されません。上位モジュールがこのページを使い終わった後は、再びPageIndexに戻す必要があります：

```java
public void add(int pgno, int freeSpace) {
    int number = freeSpace / THRESHOLD;
    lists[number].add(new PageInfo(pgno, freeSpace));
}
```

DataManagerが生成される際には、すべてのページを取得してPageIndexを埋める必要があります：

```java
// pageIndexの初期化
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

Pageを使い終わったら速やかにreleaseすることが重要です。そうしないとキャッシュが溢れてしまう恐れがあります。

### DataItem

DataItemはDM層が上位に提供するデータの抽象です。上位モジュールはアドレスを通じてDMに対応するDataItemを要求し、その中のデータを取得します。

DataItemの実装は非常にシンプルです：

```java
public class DataItemImpl implements DataItem {
    private SubArray raw;
    private byte[] oldRaw;
    private DataManagerImpl dm;
    private long uid;
    private Page pg;
}
```

dmの参照を保持するのは、DataItemの解放がdmの解放に依存していること（dmはDataItemのキャッシュも実装しているため）や、データ変更時のログ記録のためです。

DataItem内に保存されるデータ構造は以下の通りです：

```
[ValidFlag] [DataSize] [Data]
```

ValidFlagは1バイトで、そのDataItemが有効かどうかを示します。DataItemを削除する際は、この有効フラグを0に設定するだけで済みます。DataSizeは2バイトで、その後に続くDataの長さを示します。

上位モジュールはDataItemを取得後、`data()`メソッドを通じてデータを得ます。このメソッドが返す配列はコピーではなく共有された配列であるため、SubArrayを用いています。

```java
@Override
public SubArray data() {
    return new SubArray(raw.raw, raw.start+OF_DATA, raw.end);
}
```

上位モジュールがDataItemを変更しようとする場合、一定の手順に従う必要があります。変更前に`before()`を呼び、変更を取り消したい場合は`unBefore()`を呼び、変更完了後は`after()`を呼びます。この一連の流れは変更前のデータを保存し、適切にログを残すためのものです。DMはDataItemへの変更が原子性を持つことを保証します。

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

`after()`メソッドは主にdmのメソッドを呼び出して変更操作のログを記録します。詳細は省略します。

DataItemを使い終わったら、速やかに`release()`を呼び出してキャッシュを解放する必要があります（DMがDataItemをキャッシュしているため）。

```java
@Override
public void release() {
    dm.releaseDataItem(this);
}
```

### DMの実装

DataManagerはDM層が直接外部に提供するクラスであり、同時にDataItemオブジェクトのキャッシュも実装しています。DataItemのキーはページ番号とページ内オフセットからなる8バイトの符号なし整数で、ページ番号とオフセットはそれぞれ4バイトずつです。

DataItemキャッシュの`getForCache()`はキーからページ番号を解析し、pageCacheからページを取得し、オフセットに基づいてDataItemを解析して返します：

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

DataItemキャッシュの解放はDataItemをデータソースに書き戻す必要があり、ファイルの読み書きはページ単位で行われるため、DataItemが属するページをreleaseすれば十分です：

```java
@Override
protected void releaseForCache(DataItem di) {
    di.page().release();
}
```

既存ファイルからDataManagerを作成する場合と空ファイルから作成する場合では若干の違いがあります。PageCacheやLoggerの生成方法が異なるほか、空ファイルから作成する際は最初のページの初期化が必要で、既存ファイルから開く場合は最初のページの検証を行い、リカバリが必要かどうかを判断します。また最初のページのランダムバイトを再生成します。

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

最初のページの初期化や検証は基本的にPageOneクラスのメソッドで実装されています：

```java
// ファイル作成時にPageOneを初期化
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

// 既存ファイルを開く際にPageOneを読み込み、正当性を検証
boolean loadCheckPageOne() {
    try {
        pageOne = pc.getPage(1);
    } catch (Exception e) {
        Panic.panic(e);
    }
    return PageOne.checkVc(pageOne);
}
```

DM層は上位に対して読み込み、挿入、変更の3つの機能を提供します。変更は読み出したDataItemを通じて行うため、DataManagerは`read()`と`insert()`メソッドを提供すれば十分です。

`read()`はUIDからキャッシュ経由でDataItemを取得し、有効フラグを検証します：

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

`insert()`メソッドはpageIndexから挿入データを格納可能なページを取得し、ページを得た後はまず挿入ログを書き込み、その後pageXを使ってデータを挿入し、挿入位置のオフセットを返します。最後にページ情報をpageIndexに再登録します。

```java
@Override
public long insert(long xid, byte[] data) throws Exception {
    byte[] raw = DataItem.wrapDataItemRaw(data);
    if(raw.length > PageX.MAX_FREE_SPACE) {
        throw Error.DataTooLargeException;
    }

    // 利用可能なページを取得試行
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
        // まずログを書き込む
        byte[] log = Recover.insertLog(xid, pg, raw);
        logger.log(log);
        // 次に挿入操作を実行
        short offset = PageX.insert(pg, raw);

        pg.release();
        return Types.addressToUid(pi.pgno, offset);

    } finally {
        // 取得したページをpageIndexに再登録
        if(pg != null) {
            pIndex.add(pi.pgno, PageX.getFreeSpace(pg));
        } else {
            pIndex.add(pi.pgno, freeSpace);
        }
    }
}
```

DataManagerを正常に閉じる際は、キャッシュとログのクローズ処理を行い、最初のページのバイト検証を設定することを忘れてはいけません：

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

以上でDM層の説明は終わりです。

今日は2021年12月11日、A-SOULの1周年記念ライブです。A-SOULの1周年おめでとうございます！これからも2周年、3周年、10周年と続きますように！鳥の巣（北京国家体育場）で会いましょう！！！

![](https://blog-img.shinya.click/2025/bee2e73291a2ecde2667bb41f2e2c5b6.jpg)

私たちは、ASOUL！