---
title: MYDB 9. フィールドとテーブル管理
lang: ja
published: 2021-12-25T15:44:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb9
description: "テーブルマネージャ（TBM）の役割はフィールドとテーブル構造の管理です。SQLに似た文の構造化解析を通じて、Parserは文の情報を対応するクラスにカプセル化し、その後の操作を簡素化します。本章ではMYDBで使用されるSQL文の構文も紹介し、管理全体の理解の基礎を提供します。"
---

本章で扱うコードは [backend/parser](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/parser) と [backend/tbm](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/tbm) にあります。

### はじめに

本章ではTBM、すなわちテーブルマネージャの実装について概説します。TBMはフィールド構造とテーブル構造の管理を実現しています。また、MYDBで使用されるSQLに似た文の解析についても簡単に紹介します。

### SQLパーサー

ParserはSQLに似た文の構造化解析を実装し、文に含まれる情報を対応する文クラスにカプセル化します。これらのクラスは `top.guoziyang.mydb.backend.parser.statement` パッケージにあります。

MYDBが実装するSQL文の構文は以下の通りです：

```
<begin statement>
    begin [isolation level (read committedrepeatable read)]
        begin isolation level read committed

<commit statement>
    commit

<abort statement>
    abort

<create statement>
    create table <table name>
    <field name> <field type>
    <field name> <field type>
    ...
    <field name> <field type>
    [(index <field name list>)]
        create table students
        id int32,
        name string,
        age int32,
        (index id name)

<drop statement>
    drop table <table name>
        drop table students

<select statement>
    select (*<field name list>) from <table name> [<where statement>]
        select * from student where id = 1
        select name from student where id > 1 and id < 4
        select name, age, id from student where id = 12

<insert statement>
    insert into <table name> values <value list>
        insert into student values 5 "Zhang Yuanjia" 22

<delete statement>
    delete from <table name> <where statement>
        delete from student where name = "Zhang Yuanjia"

<update statement>
    update <table name> set <field name>=<value> [<where statement>]
        update student set name = "ZYJ" where id = 5

<where statement>
    where <field name> (><=) <value> [(andor) <field name> (><=) <value>]
        where age > 10 or age < 3

<field name> <table name>
    [a-zA-Z][a-zA-Z0-9_]*

<field type>
    int32 int64 string

<value>
    .*
```

parserパッケージのTokenizerクラスは文をバイト単位で解析し、空白文字や上述の字句規則に基づいて文を複数のトークンに分割します。外部には `peek()`、`pop()` メソッドを提供し、トークンの取得を容易にしています。分割の実装詳細は省略します。

Parserクラスは外部に対して `Parse(byte[] statement)` メソッドを直接提供し、そのコアはTokenizerクラスを呼び出してトークンを分割し、字句規則に従って具体的なStatementクラスにラップして返すことです。解析過程は単純で、最初のトークンにより文の種類を判別し、それぞれ処理しています。詳細は省略します。

コンパイラ理論に基づけば字句解析はオートマトンで実装すべきですが、必ずしもそうしなければならないわけではありません。

### フィールドとテーブル管理

ここでのフィールドとテーブル管理とは、各エントリ内の異なるフィールドの値などを管理するのではなく、テーブル名、テーブルのフィールド情報、フィールドのインデックスなどの構造データを管理することを指します。

TBMはVM上に構築されているため、単一フィールド情報とテーブル情報はすべてEntryに直接保存されます。フィールドのバイナリ表現は以下の通りです：

```
[FieldName][TypeName][IndexUid]
```

ここでFieldName、TypeName、及び後述のテーブル名はすべてバイト形式の文字列で保存されます。文字列の保存方法を規定し、その境界を明確にしています。

```
[StringLength][StringData]
```

TypeNameはフィールドの型で、int32、int64、stringのいずれかに限定されます。このフィールドにインデックスがある場合、IndexUIDはインデックスの二分探索木のルートを指し、なければ0となります。

この構造に基づき、UIDを通じてVMから読み込み解析するコードは以下の通りです：

```java
public static Field loadField(Table tb, long uid) {
    byte[] raw = null;
    try {
        raw = ((TableManagerImpl)tb.tbm).vm.read(TransactionManagerImpl.SUPER_XID, uid);
    } catch (Exception e) {
        Panic.panic(e);
    }
    assert raw != null;
    return new Field(uid, tb).parseSelf(raw);
}

private Field parseSelf(byte[] raw) {
    int position = 0;
    ParseStringRes res = Parser.parseString(raw);
    fieldName = res.str;
    position += res.next;
    res = Parser.parseString(Arrays.copyOfRange(raw, position, raw.length));
    fieldType = res.str;
    position += res.next;
    this.index = Parser.parseLong(Arrays.copyOfRange(raw, position, position+8));
    if(index != 0) {
        try {
            bt = BPlusTree.load(index, ((TableManagerImpl)tb.tbm).dm);
        } catch(Exception e) {
            Panic.panic(e);
        }
    }
    return this;
}
```

フィールドを作成する方法も同様で、関連情報をVMを通じて永続化すれば良いです：

```java
private void persistSelf(long xid) throws Exception {
    byte[] nameRaw = Parser.string2Byte(fieldName);
    byte[] typeRaw = Parser.string2Byte(fieldType);
    byte[] indexRaw = Parser.long2Byte(index);
    this.uid = ((TableManagerImpl)tb.tbm).vm.insert(xid, Bytes.concat(nameRaw, typeRaw, indexRaw));
}
```

データベース内には複数のテーブルが存在し、TBMはそれらをリンクリスト形式で組織化しています。各テーブルは次のテーブルを指すUIDを保持しています。テーブルのバイナリ構造は以下の通りです：

```
[TableName][NextTable]
[Field1Uid][Field2Uid]...[FieldNUid]
```

各Entry内のデータのバイト数が固定されているため、フィールド数を保存する必要はありません。UIDを通じてEntryからテーブルデータを読み込む過程はフィールド読み込みと類似しています。

テーブルやフィールドの操作で重要なステップの一つは、Where条件の範囲を計算することです。現状のMYDBのWhereは2つの条件のANDまたはORのみサポートしています。例えば条件付きDeleteでは、Whereを計算し、条件範囲内のすべてのUIDを取得する必要があります。MYDBはインデックス付きフィールドのみをWhere条件としてサポートしています。Where範囲の計算はTableクラスの `parseWhere()` と `calWhere()` メソッド、及びFieldクラスの `calExp()` メソッドを参照してください。

TBMのテーブル管理はリンクリストでつながったTable構造を用いているため、リンクリストの先頭ノード、すなわち最初のテーブルのUIDを保存する必要があります。これによりMYDB起動時にテーブル情報を迅速に取得できます。

MYDBはBooterクラスとbtファイルを用いて起動情報を管理しています。現在必要な起動情報は先頭テーブルのUIDのみです。Booterクラスは外部に `load` と `update` の2つのメソッドを提供し、原子性を保証しています。updateはbtファイルの内容を直接変更せず、まずbt_tmpファイルに書き込み、その後このファイルをbtファイルにリネームします。OSのファイルリネームの原子性により操作の原子性を確保しています。

```java
public void update(byte[] data) {
    File tmp = new File(path + BOOTER_TMP_SUFFIX);
    try {
        tmp.createNewFile();
    } catch (Exception e) {
        Panic.panic(e);
    }
    if(!tmp.canRead() || !tmp.canWrite()) {
        Panic.panic(Error.FileCannotRWException);
    }
    try(FileOutputStream out = new FileOutputStream(tmp)) {
        out.write(data);
        out.flush();
    } catch(IOException e) {
        Panic.panic(e);
    }
    try {
        Files.move(tmp.toPath(), new File(path+BOOTER_SUFFIX).toPath(), StandardCopyOption.REPLACE_EXISTING);
    } catch(IOException e) {
        Panic.panic(e);
    }
    file = new File(path+BOOTER_SUFFIX);
    if(!file.canRead() || !file.canWrite()) {
        Panic.panic(Error.FileCannotRWException);
    }
}
```

### TableManager

TBM層が外部に提供するサービスはTableManagerインターフェースで、以下の通りです：

```java
public interface TableManager {
    BeginRes begin(Begin begin);
    byte[] commit(long xid) throws Exception;
    byte[] abort(long xid);

    byte[] show(long xid);
    byte[] create(long xid, Create create) throws Exception;

    byte[] insert(long xid, Insert insert) throws Exception;
    byte[] read(long xid, Select select) throws Exception;
    byte[] update(long xid, Update update) throws Exception;
    byte[] delete(long xid, Delete delete) throws Exception;
}
```

TableManagerは最外層のServerから直接呼び出されます（MYDBはC/S構造のため）。これらのメソッドは実行結果、例えばエラー情報や結果情報のバイト配列（読み取り可能）を直接返します。

各メソッドの具体的な実装は非常にシンプルで、VMの関連メソッドを呼び出すだけです。唯一注意すべき点は、新しいテーブルを作成する際に先頭挿入法を採用しているため、テーブル作成時には必ずBooterファイルを更新する必要があることです。