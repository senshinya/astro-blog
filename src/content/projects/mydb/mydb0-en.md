---
title: MYDB 0. Project Structure and Some Things I Have to Say
lang: en
published: 2021-11-27T14:43:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb0
description: "The MYDB project is a personal undertaking aimed at exploring and implementing the fundamental principles of databases. After half a month of effort, I gradually completed it in my spare time. I picked up some database basics during college courses, though I have to admit I spent more time slacking off during my internship. Being honest about my lack of knowledge in database system interviews didn’t impact me much, but it did make me reflect on the need to proactively learn and practice database concepts, which ultimately motivated this project."
---
Project Repository: [https://github.com/CN-GuoZiyang/MYDB](https://github.com/CN-GuoZiyang/MYDB)

::github{repo="CN-GuoZiyang/MYDB"}

### Foreword (Some Rambling)

Maybe I’ve become addicted to reinventing the wheel—or maybe it’s just that I felt the need to brush up on the fundamentals of databases. I spent about half a month on this project, working late into the night after my day job to get it done.

I do have some background in databases. While taking a Database Systems course at university, I happened to be interning in Shenzhen. So, attending online classes became my official excuse for slacking off during the internship. Apart from listening to lectures, I pretty much did whatever I wanted. Incidentally, I also took Operating Systems at that time—and since I was more interested in OS, my studies there weren’t as bad as with DB.

The downside came quickly. During my second interview at ByteDance, the interviewer asked about my database knowledge. In the spirit of honesty and clarity, I admitted, “I don’t know anything about it.” Then came a question about Redis, to which I could only say, “Don’t know that either.” Luckily, the interviewer didn’t hold it against me and actually passed me along. Still, I wonder if those two “I don't knows” tanked my interview feedback a bit…

After starting work, I thought I was done with databases and CRUD since our team didn't deal with them. But change came fast—our asset management team urgently needed people. I was dispatched to help, and there, consistency was key. Suddenly, it wasn’t OK to just throw everything into Redis and not care if it made it in.

### Catalyst

One day, while browsing Github, I stumbled upon [@qw4990](https://github.com/qw4990)'s database project: [NYADB2](https://github.com/qw4990/NYADB2). It’s a simple database written in Go, with an outstanding layered design and easy-to-read code. Out of my attachment to Java, I decided to write a Java-based DB modeled on its architecture. Along the way, I referenced lots of details from this project.

Ironically, the original project was just the author’s undergraduate hobby—some people really are next-level. (Running away...)

RESPECT

### Overall Structure

MYDB is split into backend and frontend, communicating via sockets. The frontend (client) has a single responsibility: read user input, send it to the backend for execution, display the result, and wait for more input. The backend parses SQL input—if the SQL is valid, it attempts to execute and return results. Excluding the parser, MYDB’s backend is divided into five modules, each with clear responsibilities and interfaces for the modules that depend on them. The five modules are:

1.  Transaction Manager (TM)
2.  Data Manager (DM)
3.  Version Manager (VM)
4.  Index Manager (IM)
5.  Table Manager (TBM)

Their dependencies are:

![MYDB Module Dependencies](https://blog-img.shinya.click/2025/b536d4e4ea0ec97d629d82ffde917c54.jpg)

You can figure out the implementation sequence from the dependency graph—it goes: TM → DM → VM → IM → TBM.

The role of each module:

1.  TM maintains the transaction state through an XID file and provides interfaces for other modules to check a transaction’s state.
2.  DM directly manages the database file and log files. Its main duties are: 1) paged management and caching of the DB file; 2) log file management to enable recovery after errors; 3) abstracting the DB file into DataItem objects usable by higher-level modules, with caching.
3.  VM ensures serialization of transaction scheduling using a two-phase locking protocol and implements MVCC to eliminate reader/writer blocking. Two isolation levels are supported.
4.  IM provides B+ tree-based indexing. (FYI, currently WHERE clauses only work with indexed columns.)
5.  TBM handles field and table management, parses SQL, and manipulates tables based on parsed statements.

### Development Environment and Sample Run

I developed this project using WSL2 and JDK11. If you plan to run it on Windows, update the launch parameters to use Windows-style paths. Make sure your JDK version is 11 or higher—it’s not compatible with JDK 8 (though you can find and swap out the incompatibilities if you want; it’s just a few methods that don’t work).

**_It is now compatible with JDK 8_**

There are corresponding unit tests for nearly every module and submodule in the test folder. I highly recommend writing plenty of tests yourself—otherwise when something goes wrong, you’ll have no idea where the bug is coming from.

**Writing tests feels great until you skip them. Then, when a bug hits, it’s a pain.**

Be sure to adjust the compilation version in your pom.xml, and if you’re importing into an IDE, set the project’s compile version to match your JDK.

First, compile the source code with:

```shell
mvn compile
```

Then create a database at `/tmp/mydb` with:

```shell
mvn exec:java -Dexec.mainClass="top.guoziyang.mydb.backend.Launcher" -Dexec.args="-create /tmp/mydb"
```

After that, you can start the database service with default parameters with:

```shell
mvn exec:java -Dexec.mainClass="top.guoziyang.mydb.backend.Launcher" -Dexec.args="-open /tmp/mydb"
```

At this point, the DB service will be running on port 9999 locally. Open a new terminal and connect to the DB as a client with:

```shell
mvn exec:java -Dexec.mainClass="top.guoziyang.mydb.client.Launcher"
```

This will launch an interactive shell where you can enter SQL-like commands. Hitting enter sends the input to the server and displays the output.

Here’s a sample run:

![MYDB Running Example](https://blog-img.shinya.click/2025/e0ab6dcbb970d6435a5d5be24f085de8.jpg)