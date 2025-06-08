---
title: MYDB 4. ログファイルとリカバリ戦略
lang: ja
published: 2021-12-08T22:55:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb4
description: "MYDB の設計において、ログファイルは極めて重要な役割を果たし、クラッシュ後のデータ復旧を確実にします。DM 層は基盤データに対する操作のたびにログを生成・記録し、連続したログチェーンを形成します。これらのログは特定のバイナリ形式で保存され、チェックサムや各操作記録を含み、システム再起動時に正確にデータ状態を再構築し、一貫性と完全性を維持します。"
---

本章で扱うコードは [backend/dm/logger](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/dm/logger) と [backend/dm/Recover.java](https://github.com/CN-GuoZiyang/MYDB/blob/master/src/main/java/top/guoziyang/mydb/backend/dm/Recover.java) にあります。

### はじめに

MYDB はクラッシュ後のデータ復旧機能を提供しています。DM 層は基盤データに対する操作のたびに、ログをディスクに記録します。データベースがクラッシュした後、再起動時にログの内容をもとにデータファイルを復元し、一貫性を保証します。

### ログの読み書き

ログのバイナリファイルは以下の形式で配置されています：

```
[XChecksum][Log1][Log2][Log3]...[LogN][BadTail]
```

ここで、XChecksum は4バイトの整数で、以降のすべてのログに対するチェックサムです。Log1 から LogN は通常のログデータで、BadTail はデータベースがクラッシュした際に書き込み途中で残った不完全なログデータであり、存在しない場合もあります。

各ログのフォーマットは以下の通りです：

```
[Size][Checksum][Data]
```

Size は4バイトの整数で Data 部分のバイト数を示します。Checksum はそのログのチェックサムです。

単一ログのチェックサムは、指定されたシードを用いて以下のように計算されます：

```java
private int calChecksum(int xCheck, byte[] log) {
    for (byte b : log) {
        xCheck = xCheck * SEED + b;
    }
    return xCheck;
}
```

このようにして、すべてのログのチェックサムを計算し合計することで、ログファイル全体のチェックサムが得られます。

Logger はイテレーターパターンで実装されており、`next()` メソッドを通じてファイルから次のログを順次読み込み、Data 部分を解析して返します。`next()` の実装は主に `internNext()` に依存しており、位置情報 `position` は現在のログファイル読み込み位置のオフセットです：

```java
private byte[] internNext() {
    if(position + OF_DATA >= fileSize) {
        return null;
    }
    // size を読み込む
    ByteBuffer tmp = ByteBuffer.allocate(4);
    fc.position(position);
    fc.read(tmp);
    int size = Parser.parseInt(tmp.array());
    if(position + size + OF_DATA > fileSize) {
        return null;
    }

    // checksum + data を読み込む
    ByteBuffer buf = ByteBuffer.allocate(OF_DATA + size);
    fc.position(position);
    fc.read(buf);
    byte[] log = buf.array();

    // checksum を検証
    int checkSum1 = calChecksum(0, Arrays.copyOfRange(log, OF_DATA, log.length));
    int checkSum2 = Parser.parseInt(Arrays.copyOfRange(log, OF_CHECKSUM, OF_DATA));
    if(checkSum1 != checkSum2) {
        return null;
    }
    position += log.length;
    return log;
}
```

ログファイルを開く際は、まずログファイルの XChecksum を検証し、ファイル末尾に存在する可能性のある BadTail を除去します。BadTail は書き込み途中のログであるため、ファイルのチェックサムには含まれていません。BadTail を取り除くことでログファイルの一貫性が保たれます。

```java
private void checkAndRemoveTail() {
    rewind();

    int xCheck = 0;
    while(true) {
        byte[] log = internNext();
        if(log == null) break;
        xCheck = calChecksum(xCheck, log);
    }
    if(xCheck != xChecksum) {
        Panic.panic(Error.BadLogFileException);
    }

    // 正常なログの末尾までファイルを切り詰める
    truncate(position);
    rewind();
}
```

ログファイルへの書き込みも同様に、まずデータをログフォーマットに包み込み、ファイルに書き込んだ後、ファイルのチェックサムを更新します。チェックサム更新時にはバッファをフラッシュし、内容が確実にディスクに書き込まれるようにします。

```java
public void log(byte[] data) {
    byte[] log = wrapLog(data);
    ByteBuffer buf = ByteBuffer.wrap(log);
    lock.lock();
    try {
        fc.position(fc.size());
        fc.write(buf);
    } catch(IOException e) {
        Panic.panic(e);
    } finally {
        lock.unlock();
    }
    updateXChecksum(log);
}

private void updateXChecksum(byte[] log) {
    this.xChecksum = calChecksum(this.xChecksum, log);
    fc.position(0);
    fc.write(ByteBuffer.wrap(Parser.int2Byte(xChecksum)));
    fc.force(false);
}

private byte[] wrapLog(byte[] data) {
    byte[] checksum = Parser.int2Byte(calChecksum(0, data));
    byte[] size = Parser.int2Byte(data.length);
    return Bytes.concat(size, checksum, data);
}
```

### リカバリ戦略

リカバリ戦略は NYADB2 の戦略を参考にしており、やや複雑です（個人的には頭を使います）。

DM は上位モジュールに対し、2種類の操作を提供します。新規データ挿入（I）と既存データ更新（U）です。なぜ削除操作がないのかは VM セクションで説明します。

DM のログ戦略は非常にシンプルで、一言で言うと：

> I と U 操作を行う前に、必ず対応するログ操作を先に行い、ログがディスクに書き込まれたことを保証してからデータ操作を行う。

このログ戦略により、DM はデータ操作のディスク同期を柔軟に行えます。ログがデータ操作前に確実にディスクに到達していれば、たとえデータ操作が最後までディスクに同期されずにクラッシュしても、後からログを使ってデータを復元できます。

2種類のデータ操作に対して、DM は以下のログを記録します：

- (Ti, I, A, x)：トランザクション Ti が位置 A にデータ x を挿入した
- (Ti, U, A, oldx, newx)：トランザクション Ti が位置 A のデータを oldx から newx に更新した

まず並行処理を考慮しない場合、ある時点で操作しているトランザクションは一つだけです。ログは以下のように並びます：

```
(Ti, x, x), ..., (Ti, x, x), (Tj, x, x), ..., (Tj, x, x), (Tk, x, x), ..., (Tk, x, x)
```

#### シングルスレッド

シングルスレッドの場合、Ti、Tj、Tk のログは決して交差しません。この場合のログによるリカバリは簡単で、ログの最後のトランザクションが Ti だとすると：

1. Ti より前のすべてのトランザクションのログをリドゥ（redo）する
2. Ti の状態（XID ファイル）を確認し、完了済み（コミット済みまたはアボート済み）なら Ti をリドゥ、そうでなければアンドゥ（undo）する

トランザクション T のリドゥは以下の通り：

1. T のすべてのログを順方向にスキャン
2. 挿入操作 (Ti, I, A, x) なら x を位置 A に再挿入
3. 更新操作 (Ti, U, A, oldx, newx) なら位置 A の値を newx に設定

アンドゥは以下の通り：

1. T のすべてのログを逆方向にスキャン
2. 挿入操作 (Ti, I, A, x) なら位置 A のデータを削除
3. 更新操作 (Ti, U, A, oldx, newx) なら位置 A の値を oldx に戻す

注意点として、MYDB には実際の削除操作は存在せず、挿入操作のアンドゥは該当データの有効フラグを無効にするだけです。削除に関する議論は VM セクションで行います。

#### マルチスレッド

上記の操作で MYDB はシングルスレッド環境でのリカバリを保証できます。ではマルチスレッドの場合はどうでしょうか？以下の2つのケースを考えます。

1つ目：

```
T1 begin
T2 begin
T2 U(x)
T1 R(x)
...
T1 commit
MYDB break down
```

システムクラッシュ時、T2 はまだアクティブ状態です。データベース再起動時にリカバリ処理を行うと、T2 はアンドゥされ影響が消えます。しかし T1 は T2 の更新値を読み込んでおり、T2 がアンドゥされるなら T1 もアンドゥされるべきです。これがカスケードロールバックです。しかし T1 はすでにコミット済みであり、コミット済みトランザクションの影響は永続化されるべきです。ここに矛盾が生じます。したがって以下を保証する必要があります：

> 規則 1：進行中のトランザクションは、他の未コミットトランザクションのデータを一切読み取らない。

2つ目のケース（x の初期値は 0 とする）：

```
T1 begin
T2 begin
T1 set x = x+1 // ログは (T1, U, A, 0, 1)
T2 set x = x+1 // ログは (T2, U, A, 1, 2)
T2 commit
MYDB break down
```

クラッシュ時、T1 はまだアクティブです。再起動後のリカバリで、T1 はアンドゥされ、T2 はリドゥされます。しかしアンドゥとリドゥの順序に関わらず、x の最終値は 0 か 2 のどちらかになり、これは誤りです。

> この問題の根本原因は、ログが単純すぎて「前の状態」と「後の状態」だけを記録し、単純に「前の状態」でアンドゥ、「後の状態」でリドゥしていることにあります。この単純なログとリカバリ方式では、すべてのデータベース操作の意味をカバーできません。

解決策は2つあります：

1. ログの種類を増やす
2. データベース操作を制限する

MYDB は後者を採用し、以下を保証します：

> 規則 2：進行中のトランザクションは、他の未コミットトランザクションが変更または生成したデータを一切変更しない。

MYDB では VM の存在により、DM 層に渡される実際の操作列は規則 1 と規則 2 を満たすことが保証されます。VM がこれらの規則をどう保証するかは VM 層の節で説明します（VM はかなり難しいです）。これらの規則があれば、並行処理下でのログリカバリは非常にシンプルになります：

1. クラッシュ時に完了済み（コミット済みまたはアボート済み）トランザクションをすべてリドゥする
2. クラッシュ時に未完了（アクティブ）トランザクションをすべてアンドゥする

リカバリ後、データベースはすべての完了済みトランザクションが終了し、未完了トランザクションが開始前の状態に戻ります。

#### 実装

まず2種類のログフォーマットを定義します：

```java
private static final byte LOG_TYPE_INSERT = 0;
private static final byte LOG_TYPE_UPDATE = 1;

// updateLog:
// [LogType] [XID] [UID] [OldRaw] [NewRaw]

// insertLog:
// [LogType] [XID] [Pgno] [Offset] [Raw]
```

原理で述べた通り、リカバリ処理は主に2段階です：完了済みトランザクションのリドゥ、未完了トランザクションのアンドゥ。

```java
private static void redoTranscations(TransactionManager tm, Logger lg, PageCache pc) {
    lg.rewind();
    while(true) {
        byte[] log = lg.next();
        if(log == null) break;
        if(isInsertLog(log)) {
            InsertLogInfo li = parseInsertLog(log);
            long xid = li.xid;
            if(!tm.isActive(xid)) {
                doInsertLog(pc, log, REDO);
            }
        } else {
            UpdateLogInfo xi = parseUpdateLog(log);
            long xid = xi.xid;
            if(!tm.isActive(xid)) {
                doUpdateLog(pc, log, REDO);
            }
        }
    }
}

private static void undoTranscations(TransactionManager tm, Logger lg, PageCache pc) {
    Map<Long, List<byte[]>> logCache = new HashMap<>();
    lg.rewind();
    while(true) {
        byte[] log = lg.next();
        if(log == null) break;
        if(isInsertLog(log)) {
            InsertLogInfo li = parseInsertLog(log);
            long xid = li.xid;
            if(tm.isActive(xid)) {
                if(!logCache.containsKey(xid)) {
                    logCache.put(xid, new ArrayList<>());
                }
                logCache.get(xid).add(log);
            }
        } else {
            UpdateLogInfo xi = parseUpdateLog(log);
            long xid = xi.xid;
            if(tm.isActive(xid)) {
                if(!logCache.containsKey(xid)) {
                    logCache.put(xid, new ArrayList<>());
                }
                logCache.get(xid).add(log);
            }
        }
    }

    // すべてのアクティブログを逆順にアンドゥ
    for(Entry<Long, List<byte[]>> entry : logCache.entrySet()) {
        List<byte[]> logs = entry.getValue();
        for (int i = logs.size()-1; i >= 0; i --) {
            byte[] log = logs.get(i);
            if(isInsertLog(log)) {
                doInsertLog(pc, log, UNDO);
            } else {
                doUpdateLog(pc, log, UNDO);
            }
        }
        tm.abort(entry.getKey());
    }
}
```

updateLog と insertLog のリドゥ・アンドゥ処理は、以下のように一つのメソッドにまとめて実装しています：

```java
private static void doUpdateLog(PageCache pc, byte[] log, int flag) {
    int pgno;
    short offset;
    byte[] raw;
    if(flag == REDO) {
        UpdateLogInfo xi = parseUpdateLog(log);
        pgno = xi.pgno;
        offset = xi.offset;
        raw = xi.newRaw;
    } else {
        UpdateLogInfo xi = parseUpdateLog(log);
        pgno = xi.pgno;
        offset = xi.offset;
        raw = xi.oldRaw;
    }
    Page pg = null;
    try {
        pg = pc.getPage(pgno);
    } catch (Exception e) {
        Panic.panic(e);
    }
    try {
        PageX.recoverUpdate(pg, raw, offset);
    } finally {
        pg.release();
    }
}

private static void doInsertLog(PageCache pc, byte[] log, int flag) {
    InsertLogInfo li = parseInsertLog(log);
    Page pg = null;
    try {
        pg = pc.getPage(li.pgno);
    } catch(Exception e) {
        Panic.panic(e);
    }
    try {
        if(flag == UNDO) {
            DataItem.setDataItemRawInvalid(li.raw);
        }
        PageX.recoverInsert(pg, li.raw, li.offset);
    } finally {
        pg.release();
    }
}
```

注意すべきは、`doInsertLog()` の削除処理で `DataItem.setDataItemRawInvalid(li.raw);` を使っている点です。DataItem は次節で説明しますが、これは該当データアイテムの有効ビットを無効に設定し、論理削除を実現しています。