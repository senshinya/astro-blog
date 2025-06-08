---
title: MYDB 10. Implementation of Server, Client, and Their Communication Rules
lang: en
published: 2021-12-25T18:26:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb10
description: "MYDB adopts a classic Client/Server (C/S) architecture similar to MySQL, supporting multiple clients connecting to a server via sockets to execute SQL queries and return results. The communication uses a custom binary protocol, though plaintext transmission is also feasible for simplicity. The data transport structure between server and client ensures efficient data exchange and processing."
---
All the code discussed in this chapter can be found in [backend/server](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/server), [client](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/client), and [transport](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/transport).

### Preface

MYDB is designed with a Client/Server (C/S) architecture, much like MySQL. You can launch a server, and have multiple clients connect to it. Communication is done via sockets, allowing clients to execute SQL queries and receive the results.

### C/S Communication

MYDB employs a custom binary protocol for client-server communication. Of course, if you feel this is too cumbersome, plain text transmission is also a possibility.

The fundamental unit of transmission is the `Package`:

```java
public class Package {
    byte[] data;
    Exception err;
}
```

Before sending, each `Package` is encoded into a byte array by an `Encoder`, and upon reception, it is decoded back into a `Package` object. The encoding and decoding format is as follows:

```
[Flag][data]
```

If `flag` is 0, the packet contains normal data, and `data` is the payload; if `flag` is 1, the packet signals an error, and `data` contains the error message from `Exception.getMessage()`. For example:

```java
public class Encoder {
    public byte[] encode(Package pkg) {
        if(pkg.getErr() != null) {
            Exception err = pkg.getErr();
            String msg = "Intern server error!";
            if(err.getMessage() != null) {
                msg = err.getMessage();
            }
            return Bytes.concat(new byte[]{1}, msg.getBytes());
        } else {
            return Bytes.concat(new byte[]{0}, pkg.getData());
        }
    }

    public Package decode(byte[] data) throws Exception {
        if(data.length < 1) {
            throw Error.InvalidPkgDataException;
        }
        if(data[0] == 0) {
            return new Package(Arrays.copyOfRange(data, 1, data.length), null);
        } else if(data[0] == 1) {
            return new Package(null, new RuntimeException(new String(Arrays.copyOfRange(data, 1, data.length))));
        } else {
            throw Error.InvalidPkgDataException;
        }
    }
}
```

Once encoded, data is sent out over the network using the `Transporter` class, which writes to an output stream. To avoid issues with special characters, data is converted to a hexadecimal string with a newline appended at the end. This makes it straightforward to use `BufferedReader` and `Writer` to read and write data line by line:

```java
public class Transporter {
    private Socket socket;
    private BufferedReader reader;
    private BufferedWriter writer;

    public Transporter(Socket socket) throws IOException {
        this.socket = socket;
        this.reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));
        this.writer = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream()));
    }

    public void send(byte[] data) throws Exception {
        String raw = hexEncode(data);
        writer.write(raw);
        writer.flush();
    }

    public byte[] receive() throws Exception {
        String line = reader.readLine();
        if(line == null) {
            close();
        }
        return hexDecode(line);
    }

    public void close() throws IOException {
        writer.close();
        reader.close();
        socket.close();
    }

    private String hexEncode(byte[] buf) {
        return Hex.encodeHexString(buf, true)+"n";
    }

    private byte[] hexDecode(String buf) throws DecoderException {
        return Hex.decodeHex(buf);
    }
}
```

The `Packager` class wraps both the `Encoder` and `Transporter`, providing a simple interface for sending and receiving:

```java
public class Packager {
    private Transporter transpoter;
    private Encoder encoder;

    public Packager(Transporter transpoter, Encoder encoder) {
        this.transpoter = transpoter;
        this.encoder = encoder;
    }

    public void send(Package pkg) throws Exception {
        byte[] data = encoder.encode(pkg);
        transpoter.send(data);
    }

    public Package receive() throws Exception {
        byte[] data = transpoter.receive();
        return encoder.decode(data);
    }

    public void close() throws Exception {
        transpoter.close();
    }
}
```

### Implementation of Server and Client

Java's built-in sockets are used directly for both the server and client.

The server starts a `ServerSocket` to listen for incoming connections, and spawns a new thread to handle each incoming request. This is basically textbook socket programming.

The `HandleSocket` class implements `Runnable`. After establishing a connection, it initializes the `Packager` and then enters a loop to keep receiving and processing data from the client:

```java
Packager packager = null;
try {
    Transporter t = new Transporter(socket);
    Encoder e = new Encoder();
    packager = new Packager(t, e);
} catch(IOException e) {
    e.printStackTrace();
    try {
        socket.close();
    } catch (IOException e1) {
        e1.printStackTrace();
    }
    return;
}
Executor exe = new Executor(tbm);
while(true) {
    Package pkg = null;
    try {
        pkg = packager.receive();
    } catch(Exception e) {
        break;
    }
    byte[] sql = pkg.getData();
    byte[] result = null;
    Exception e = null;
    try {
        result = exe.execute(sql);
    } catch (Exception e1) {
        e = e1;
        e.printStackTrace();
    }
    pkg = new Package(result, e);
    try {
        packager.send(pkg);
    } catch (Exception e1) {
        e1.printStackTrace();
        break;
    }
}
```

The core of the request handling lies in the `Executor` class, which invokes the `Parser` to obtain a structured object for the incoming SQL statement, and dispatches the request to different methods of the Table Manager (`TBM`) depending on the object type. The detailed implementation won't be covered here.

The `top.guoziyang.mydb.backend.Launcher` class acts as the server's entry point. It parses command-line arguments, the most important being `-open` and `-create`. Depending on which is used, `Launcher` decides whether to create a new database file or open an existing one.

```java
private static void createDB(String path) {
    TransactionManager tm = TransactionManager.create(path);
    DataManager dm = DataManager.create(path, DEFALUT_MEM, tm);
    VersionManager vm = new VersionManagerImpl(tm, dm);
    TableManager.create(path, vm, dm);
    tm.close();
    dm.close();
}

private static void openDB(String path, long mem) {
    TransactionManager tm = TransactionManager.open(path);
    DataManager dm = DataManager.open(path, mem, tm);
    VersionManager vm = new VersionManagerImpl(tm, dm);
    TableManager tbm = TableManager.open(path, vm, dm);
    new Server(port, tbm).start();
}
```

The process for the client to connect to the server is highly straightforward. The client provides a simple shell, which reads user input and calls `Client.execute()`:

```java
public byte[] execute(byte[] stat) throws Exception {
    Package pkg = new Package(stat, null);
    Package resPkg = rt.roundTrip(pkg);
    if(resPkg.getErr() != null) {
        throw resPkg.getErr();
    }
    return resPkg.getData();
}
```

The `RoundTripper` class simply implements a single send-receive transaction:

```java
public Package roundTrip(Package pkg) throws Exception {
    packager.send(pkg);
    return packager.receive();
}
```

Finally, here is the client’s entry point—just fire up the shell:

```java
public class Launcher {
    public static void main(String[] args) throws UnknownHostException, IOException {
        Socket socket = new Socket("127.0.0.1", 9999);
        Encoder e = new Encoder();
        Transporter t = new Transporter(socket);
        Packager packager = new Packager(t, e);

        Client client = new Client(packager);
        Shell shell = new Shell(client);
        shell.run();
    }
}
```

Today is December 26, 2021—Christmas Day.

Long live the invincible thought of Mao Zedong!