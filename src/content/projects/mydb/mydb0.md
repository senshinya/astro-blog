---
title: MYDB 0. 项目结构和一些不得不说的话
lang: zh
published: 2021-11-27T14:43:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb0
description: "MYDB 项目是一个旨在探索和实现数据库基本原理的个人作品，经历了大半个月的努力，在闲暇时间逐步完成。我在学校学习数据库系统的过程中，积累了一些基础知识，尽管在实习期间更多是借机“摸鱼”。在面试时的坦诚回答虽未造成太大影响，但也促使他重新审视数据库的知识，决定主动学习和实践，从而推动了这个项目的诞生。"
---
项目地址：[https://github.com/CN-GuoZiyang/MYDB](https://github.com/CN-GuoZiyang/MYDB)

::github{repo="CN-GuoZiyang/MYDB"}

### 前言（一些废话）

或许是造轮子上瘾了，也有可能只是觉得需要补一补数据库的基本原理，大概花了大半个月，利用下班到半夜这段时间，我做完了这个项目。

和数据库也算有点渊源的，在学校开设数据库系统这门课的时候，我恰巧在深圳实习。于是乎，上网课成了我实习期间名正言顺的摸鱼理由，除了听课，其他啥都干。同样，操作系统也是在那个时候教授的，因为我对 OS 还是有点兴趣的，所以学得没有 DB 那么烂。

很快副作用就来了，字节二面的时候，面试官问我对数据库了解怎么样，本着坦诚清晰的原则，我说“一点也不了解”，于是又问我 redis 呢，我也只好说“也不了解”。好在面试官倒也没计较，还让我过了。就是不知道这俩“不知道”有没有拖烂我的面评……

工作之后，组里的内容和数据库倒也没有什么关系，本以为就此远离了数据库和 CRUD，没想到变化来得如此的快，隔壁资管组急缺人，向部门申请调人力支援，于是我就被弄过去支援了。资管对于一致性要求颇高，自然不能像原来一样，啥数据都往 redis 塞，没塞进去也没关系了……

### 契机

某天在 Github 网上冲浪的时候，偶然就看到了 [@qw4990](https://github.com/qw4990) 大佬的数据库项目：[NYADB2](https://github.com/qw4990/NYADB2)。这是一个用 golang 实现的一个简单的数据库，分层设计及其优秀，代码也便于阅读。出于对 Java 的念念不忘，我就依据这个项目的基本架构，写一个 Java 版的 DB，实现过程中，有许多细节都参照了这个项目。

令人汗颜的是，这个项目是作者本科的兴趣项目，也许这就是大佬吧（逃

RESPECT

### 整体结构

MYDB 分为后端和前端，前后端通过 socket 进行交互。前端（客户端）的职责很单一，读取用户输入，并发送到后端执行，输出返回结果，并等待下一次输入。MYDB 后端则需要解析 SQL，如果是合法的 SQL，就尝试执行并返回结果。不包括解析器，MYDB 的后端划分为五个模块，每个模块都又一定的职责，通过接口向其依赖的模块提供方法。五个模块如下：

1.  Transaction Manager (TM)
2.  Data Manager (DM)
3.  Version Manager (VM)
4.  Index Manager (IM)
5.  Table Manager (TBM)

五个模块的依赖关系如下：

![MYDB 模块依赖](https://blog-img.shinya.click/2025/b536d4e4ea0ec97d629d82ffde917c54.jpg)

从这个依赖图中，拓扑排序一下就能看出实现顺序。本教程的实现顺序是 TM -> DM -> VM -> IM -> TBM

每个模块的职责如下：

1.  TM 通过维护 XID 文件来维护事务的状态，并提供接口供其他模块来查询某个事务的状态。
2.  DM 直接管理数据库 DB 文件和日志文件。DM 的主要职责有：1) 分页管理 DB 文件，并进行缓存；2) 管理日志文件，保证在发生错误时可以根据日志进行恢复；3) 抽象 DB 文件为 DataItem 供上层模块使用，并提供缓存。
3.  VM 基于两段锁协议实现了调度序列的可串行化，并实现了 MVCC 以消除读写阻塞。同时实现了两种隔离级别。
4.  IM 实现了基于 B+ 树的索引，BTW，目前 where 只支持已索引字段。
5.  TBM 实现了对字段和表的管理。同时，解析 SQL 语句，并根据语句操作表。

### 开发环境和运行示例

项目开发时使用的 WSL2 和 JDK11，如果要在 Windows 上执行，请替换启动参数中的路径为 Windows，JDK 版本要保证在 11 或以上，不兼容 JDK 8（或者可以自行寻找不兼容的方法，替换为兼容即可，应该只有个别方法不兼容）。

**_目前已经兼容 JDK 8_**

几乎每个模块和子模块都在 test 文件夹中有对应的单测，同学们一定也要多写写单测，不然到后面一跑起来都不知道 bug 从哪来的。

**不写单测一时爽，出了 bug 火葬场（**

注意首先需要在 pom.xml 中调整编译版本，如果导入 IDE，请更改项目的编译版本以适应你的 JDK

首先执行以下命令编译源码：

```shell
mvn compile
```

接着执行以下命令以 /tmp/mydb 作为路径创建数据库：

```shell
mvn exec:java -Dexec.mainClass="top.guoziyang.mydb.backend.Launcher" -Dexec.args="-create /tmp/mydb"
```

随后通过以下命令以默认参数启动数据库服务：

```shell
mvn exec:java -Dexec.mainClass="top.guoziyang.mydb.backend.Launcher" -Dexec.args="-open /tmp/mydb"
```

这时数据库服务就已经启动在本机的 9999 端口。重新启动一个终端，执行以下命令启动客户端连接数据库：

```shell
mvn exec:java -Dexec.mainClass="top.guoziyang.mydb.client.Launcher"
```

会启动一个交互式命令行，就可以在这里输入类 SQL 语法，回车会发送语句到服务，并输出执行的结果。

一个执行示例：

![MYDB 运行示例](https://blog-img.shinya.click/2025/e0ab6dcbb970d6435a5d5be24f085de8.jpg)