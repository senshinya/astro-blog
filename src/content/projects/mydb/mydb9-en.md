---
title: MYDB 9. Field and Table Management
lang: en
published: 2021-12-25T15:44:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb9
description: "The responsibility of the Table Manager (TBM) is to manage field and table structures. By structurally parsing SQL-like statements, the Parser encapsulates statement information into corresponding classes, which simplifies subsequent operations. This chapter also includes the SQL statement grammar used by MYDB, providing a foundation for understanding the management process."
---
All the code discussed in this chapter can be found in [backend/parser](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/parser) and [backend/tbm](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/tbm).

### Preface

This chapter provides an overview of the implementation of TBM, or the Table Manager. TBM manages the structure of fields and tables. Additionally, it briefly introduces how MYDB parses its SQL-like statements.

### SQL Parser

The Parser structurally parses SQL-like statements, encapsulating the information contained in a statement into corresponding classes. These classes reside in the `top.guoziyang.mydb.backend.parser.statement` package.

MYDB supports the following SQL statement grammar:

```
<begin statement>
    begin [isolation level (read committed|repeatable read)]
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
    select (*|<field name list>) from <table name> [<where statement>]
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
    where <field name> (>|<|=) <value> [(and|or) <field name> (>|<|=) <value>]
        where age > 10 or age < 3

<field name> <table name>
    [a-zA-Z][a-zA-Z0-9_]*

<field type>
    int32 int64 string

<value>
    .*
```

The `Tokenizer` class in the parser package parses each statement byte by byte, splitting it into multiple tokens according to whitespace or the lexical rules above. It provides `peek()` and `pop()` methods to make token retrieval convenient for parsing. The actual splitting implementation is omitted here for brevity.

The `Parser` class exposes the `Parse(byte[] statement)` method, which uses the `Tokenizer` to split tokens and wraps them into specific `Statement` classes based on the lexical rules and returns them. The parsing process is straightforward: it uses the first token to distinguish the statement type and then parses accordingly. Detailed logic is omitted here.

Although, according to compiler theory, lexical analysis should use a finite automaton, this approach is still effective enough...

### Field and Table Management

It’s important to clarify: field and table management here does not refer to managing the values of individual fields in each entry, but rather to managing the schema data of tables and fields themselves—such as table names, field information, and field indexes.

Since TBM is based on VM, individual field and table schema data are stored directly in Entries. The binary format for a field is:

```
[FieldName][TypeName][IndexUid]
```

FieldName and TypeName, as well as the table name later, are all stored as strings in byte form. Here, string storage has a specific format to clearly define its boundaries:

```
[StringLength][StringData]
```

`TypeName` indicates the type of the field and is limited to `int32`, `int64`, and `string`. If a field has an index, `IndexUID` points to the root of the index’s binary tree; otherwise, it is 0.

To read and parse a field from the VM by its UID, the following approach can be used:

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

Creating a field is similar—the relevant information simply needs to be persisted via the VM:

```java
private void persistSelf(long xid) throws Exception {
    byte[] nameRaw = Parser.string2Byte(fieldName);
    byte[] typeRaw = Parser.string2Byte(fieldType);
    byte[] indexRaw = Parser.long2Byte(index);
    this.uid = ((TableManagerImpl)tb.tbm).vm.insert(xid, Bytes.concat(nameRaw, typeRaw, indexRaw));
}
```

Since a database can have multiple tables, TBM uses a linked list to organize them—each table entry saves the UID of the next table. The binary structure of a table is as follows:

```
[TableName][NextTable]
[Field1Uid][Field2Uid]...[FieldNUid]
```

Because the byte count of each entry’s data is fixed, there’s no need to store the field count. Reading table data from an entry via UID is similar to reading field data.

A crucial step in operations on tables and fields is calculating the range for the WHERE clause. At present, MYDB's WHERE clause only supports up to two conditions with AND or OR. For example, with a conditional DELETE, the system computes the WHERE clause to obtain all UIDs within the condition range. MYDB only supports indexed fields for WHERE conditions. To see exactly how the WHERE range is computed, check the Table’s `parseWhere()` and `calWhere()` methods, as well as the Field class’s `calExp()` method.

Since TBM organizes tables in a linked-list fashion, it must save a head pointer (the UID of the first table), to allow quick access to table information when MYDB starts.

MYDB uses the `Booter` class and a `bt` file to manage startup information. For now, this is limited to the head table's UID. The `Booter` class offers two methods, `load` and `update`, with atomic guarantees. When updating, it doesn't modify the `bt` file directly but first writes to a `bt_tmp` file, then renames it to `bt`. This leverages the atomicity of the file system’s rename operation to ensure data consistency.

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

The TableManager (TBM layer) exposes the following interface:

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

TableManager is called directly by the top-level Server (since MYDB uses the client/server architecture). These methods return the results of execution directly—for example, error information or result data as a byte array (for readability).

The concrete implementations of these methods are quite straightforward—usually just calling the related VM methods and are not elaborated on here. One small implementation detail worth noting is that when creating a new table, a head-insertion method is used, so the Booter file must be updated each time a new table is created.