---
title: MYDB 10. サーバー・クライアントの実装と通信規則
lang: ja
published: 2021-12-25T18:26:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb10
description: "MYDBはC/S構造を採用し、MySQLに似ており、複数のクライアントがソケットを通じてサーバーに接続し、SQLクエリを実行して結果を返します。通信は特殊なバイナリ形式を用いていますが、実装を簡素化するためにプレーンテキストでの送信も選択可能です。サーバーとクライアント間の基本的な伝送構造により、データの有効なやり取りと処理が保証されています。"
---
本章で扱うコードは [backend/server](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/server)、[client](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/client)、および [transport](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/transport) にあります。

### はじめに

MYDB は C/S 構造として設計されており、MySQL に似ています。サーバーを起動し、複数のクライアントがソケットを通じて接続し、SQL を実行して結果を返すことができます。

### C/S 通信

MYDB はクライアントとサーバー間の通信に特殊なバイナリ形式を使用しています。もちろん、面倒であればプレーンテキストでの通信も可能です。

伝送の最も基本的な構造は Package です：

```java
public class Package {
    byte[] data;
    Exception err;
}
```

各 Package は送信前に Encoder によってバイト配列にエンコードされ、受信側でも同様に Encoder によって Package オブジェクトにデコードされます。エンコード・デコードのルールは以下の通りです：

```
[Flag][data]
```

flag が 0 の場合はデータを送信していることを示し、その data はデータ本体です。flag が 1 の場合はエラーを送信しており、data は Exception.getMessage() によるエラーメッセージとなります。具体的には以下のようになります：

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

エンコードされた情報は Transporter クラスを通じて出力ストリームに書き込まれ送信されます。特殊文字による問題を避けるため、データは 16 進文字列（Hex String）に変換され、末尾に改行コードが付加されます。これにより送受信時は BufferedReader と Writer を使い、行単位で簡単に読み書きできます。

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

Packager は Encoder と Transporter の組み合わせで、send と receive メソッドを直接提供します：

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

### サーバーとクライアントの実装

サーバーとクライアントは手抜きで Java のソケットを直接使用しています。

サーバーは ServerSocket を起動してポートを監視し、リクエストが来ると新しいスレッドに処理を任せます。この部分はほぼ定石通りです。

HandleSocket クラスは Runnable を実装し、接続確立後に Packager を初期化し、クライアントからのデータをループで受信して処理します：

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

処理の核は Executor クラスで、Executor は Parser を呼び出して構造化された文情報オブジェクトを取得し、そのオブジェクトの種類に応じて TBM の各種メソッドを呼び出して処理します。詳細は省略します。

top.guoziyang.mydb.backend.Launcher クラスはサーバーの起動エントリーポイントです。このクラスはコマンドライン引数を解析し、重要な引数として -open または -create があります。Launcher はこれらの引数に基づき、データベースファイルの作成か既存データベースの起動かを決定します。

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

クライアントがサーバーに接続する過程も定石通りです。クライアントは簡単な Shell を持ち、ユーザー入力を読み込み Client.execute() を呼び出します。

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

RoundTripper クラスは単一の送受信動作を実装しています：

```java
public Package roundTrip(Package pkg) throws Exception {
    packager.send(pkg);
    return packager.receive();
}
```

最後にクライアントの起動エントリーポイントを示します。非常にシンプルで、Shell を起動するだけです：

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

今日は 2021 年 12 月 26 日、クリスマスです。

無敵の毛沢東思想万歳！