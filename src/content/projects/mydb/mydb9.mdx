---
title: MYDB 9. 字段与表管理
published: 2021-12-25T15:44:00+08:00
tags: ["java", "mydb"]
description: "本章介绍 MYDB 的表管理器 TBM 和 SQL 语句的结构化解析。"
---
本章涉及代码都在 [backend/parser](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/parser) 与 [backend/tbm](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/tbm) 中。

### 前言

本章概述 TBM，即表管理器的实现。TBM 实现了对字段结构和表结构的管理。同时简要介绍 MYDB 使用的类 SQL 语句的解析。

### SQL 解析器

Parser 实现了对类 SQL 语句的结构化解析，将语句中包含的信息封装为对应语句的类，这些类可见 top.guoziyang.mydb.backend.parser.statement 包。

MYDB 实现的 SQL 语句语法如下：

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

parser 包的 Tokenizer 类，对语句进行逐字节解析，根据空白符或者上述词法规则，将语句切割成多个 token。对外提供了 `peek()`、`pop()` 方法方便取出 Token 进行解析。切割的实现不赘述。

Parser 类则直接对外提供了 `Parse(byte[] statement)` 方法，核心就是一个调用 Tokenizer 类分割 Token，并根据词法规则包装成具体的 Statement 类并返回。解析过程很简单，仅仅是根据第一个 Token 来区分语句类型，并分别处理，不再赘述。

虽然根据编译原理，词法分析应当写一个自动机去做的，但是又不是不能用

### 字段与表管理

注意，这里的字段与表管理，不是管理各个条目中不同的字段的数值等信息，而是管理表和字段的结构数据，例如表名、表字段信息和字段索引等。

由于 TBM 基于 VM，单个字段信息和表信息都是直接保存在 Entry 中。字段的二进制表示如下：

```
[FieldName][TypeName][IndexUid]
```

这里 FieldName 和 TypeName，以及后面的表明，存储的都是字节形式的字符串。这里规定一个字符串的存储方式，以明确其存储边界。

```
[StringLength][StringData]
```

TypeName 为字段的类型，限定为 int32、int64 和 string 类型。如果这个字段有索引，那个 IndexUID 指向了索引二叉树的根，否则该字段为 0。

根据这个结构，通过一个 UID 从 VM 中读取并解析如下：

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

创建一个字段的方法类似，将相关的信息通过 VM 持久化即可：

```java
private void persistSelf(long xid) throws Exception {
    byte[] nameRaw = Parser.string2Byte(fieldName);
    byte[] typeRaw = Parser.string2Byte(fieldType);
    byte[] indexRaw = Parser.long2Byte(index);
    this.uid = ((TableManagerImpl)tb.tbm).vm.insert(xid, Bytes.concat(nameRaw, typeRaw, indexRaw));
}
```

一个数据库中存在多张表，TBM 使用链表的形式将其组织起来，每一张表都保存一个指向下一张表的 UID。表的二进制结构如下：

```
[TableName][NextTable]
[Field1Uid][Field2Uid]...[FieldNUid]
```

这里由于每个 Entry 中的数据，字节数是确定的，于是无需保存字段的个数。根据 UID 从 Entry 中读取表数据的过程和读取字段的过程类似。

对表和字段的操作，有一个很重要的步骤，就是计算 Where 条件的范围，目前 MYDB 的 Where 只支持两个条件的与和或。例如有条件的 Delete，计算 Where，最终就需要获取到条件范围内所有的 UID。MYDB 只支持已索引字段作为 Where 的条件。计算 Where 的范围，具体可以查看 Table 的 `parseWhere()` 和 `calWhere()` 方法，以及 Field 类的 `calExp()` 方法。

由于 TBM 的表管理，使用的是链表串起的 Table 结构，所以就必须保存一个链表的头节点，即第一个表的 UID，这样在 MYDB 启动时，才能快速找到表信息。

MYDB 使用 Booter 类和 bt 文件，来管理 MYDB 的启动信息，虽然现在所需的启动信息，只有一个：头表的 UID。Booter 类对外提供了两个方法：load 和 update，并保证了其原子性。update 在修改 bt 文件内容时，没有直接对 bt 文件进行修改，而是首先将内容写入一个 bt\_tmp 文件中，随后将这个文件重命名为 bt 文件。以期通过操作系统重命名文件的原子性，来保证操作的原子性。

```java
public void update(byte[] data) {
    File tmp = new File(path + BOOTER_TMP_SUFFIX);
    try {
        tmp.createNewFile();
    } catch (Exception e) {
        Panic.panic(e);
    }
    if(!tmp.canRead()  !tmp.canWrite()) {
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
    if(!file.canRead()  !file.canWrite()) {
        Panic.panic(Error.FileCannotRWException);
    }
}
```

### TableManager

TBM 层对外提供服务的是 TableManager 接口，如下：

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

由于 TableManager 已经是直接被最外层 Server 调用（MYDB 是 C/S 结构），这些方法直接返回执行的结果，例如错误信息或者结果信息的字节数组（可读）。

各个方法的具体实现很简单，不再赘述，无非是调用 VM 的相关方法。唯一值得注意的一个小点是，在创建新表时，采用的时头插法，所以每次创建表都需要更新 Booter 文件。