---
title: MYDB 2. 参照カウントキャッシュフレームワークと共有メモリアレイ
lang: ja
published: 2021-11-30T23:18:00+08:00
tags: ["java", "mydb"]
abbrlink: projects/mydb/mydb2
description: "データマネージャ（DM）は上位モジュールとファイルシステムの橋渡し役を担い、ページ管理とキャッシュ管理を行いながら、データの安全性と復旧能力を確保します。特にキャッシュ戦略においては、DMは従来のLRUではなく参照カウント方式を採用し、キャッシュの汎用性と効率性を高め、後続のデータ操作の基盤を築いています。"
---
本章で扱うコードはすべて [backend/common](https://github.com/CN-GuoZiyang/MYDB/tree/master/src/main/java/top/guoziyang/mydb/backend/common) にあります。

### はじめに

この章から、MYDBの最も低層のモジュールであるデータマネージャ（Data Manager、以下DM）について議論を始めます。

> DMはデータベースのDBファイルとログファイルを直接管理します。DMの主な役割は、1) DBファイルのページ管理とキャッシュ、2) ログファイルの管理とエラー発生時のログに基づく復旧の保証、3) DBファイルをDataItemとして抽象化し上位モジュールに提供し、かつキャッシュ機能を備えることです。

DMの機能は大きく二つにまとめられます。ひとつは上位モジュールとファイルシステムの間の抽象層として、下位ではファイルの直接読み書きを行い、上位にはデータのラッピングを提供すること。もうひとつはログ機能です。

注目すべきは、上位にも下位にもDMはキャッシュ機能を提供しており、メモリ操作によって効率を確保している点です。

### 参照カウントキャッシュフレームワーク

#### なぜLRUではないのか？

ページ管理やデータ項目（DataItem）管理はキャッシュを伴うため、より汎用的なキャッシュフレームワークを設計しました。

ここで、多くの方は疑問に思うでしょう。なぜ「非常に先進的な」LRU戦略ではなく、参照カウント戦略を採用したのか？

まずキャッシュのインターフェース設計から説明します。もしLRUキャッシュを使うなら、`get(key)`インターフェースだけで十分で、キャッシュの解放は満杯になった際に自動的に行われます。例えば以下のような状況を想像してください。ある時点でキャッシュが満杯となり、あるリソースが追い出されました。その時、上位モジュールがそのリソースを強制的にデータソースへフラッシュしようとしたとします。そのリソースはちょうど追い出されたものでした。すると上位モジュールは、そのデータがキャッシュから消えたことに気づき、次のような困った状況に陥ります。果たしてデータソースへ戻す操作は必要か？

1. 戻さない。キャッシュが追い出されたタイミングが不明で、追い出し後にデータ項目が変更されたかも分からず非常に危険。
2. 戻す。もし追い出された時のデータと現在が同じなら無駄な戻しになる。
3. キャッシュに戻し、次回追い出し時に戻す。問題が解決したように見えるが、既にキャッシュは満杯なので、再度リソースを追い出さなければならず、キャッシュの揺れ（スラッシング）を引き起こす可能性がある。

もちろんリソースの最終更新時刻を記録し、キャッシュの追い出し時刻も記録することは可能ですが……

> 不必要なら実体を増やすな。――オッカムの剃刀

問題の根本は、LRU戦略ではリソースの追い出しが制御不能であり、上位モジュールがそれを感知できないことにあります。参照カウント戦略はこれを解決します。上位モジュールが能動的に参照を解放しなければ、キャッシュはリソースを追い出しません。

これが参照カウント法です。`release(key)`というメソッドを追加し、上位モジュールがリソースを使わなくなった際に参照を解放します。参照がゼロになると、キャッシュはそのリソースを追い出します。

同様に、キャッシュが満杯になった場合、参照カウント法は自動的にキャッシュを解放できないため、直接エラーを返すべきです（JVMのように、直接OOMになるイメージです）。

#### 実装

`AbstractCache<T>`は抽象クラスで、内部に二つの抽象メソッドがあり、実装クラスが具体的な操作を実装します。

```java
/**
 * リソースがキャッシュに存在しない場合の取得動作
 */
protected abstract T getForCache(long key) throws Exception;
/**
 * リソースが追い出される際の書き戻し動作
 */
protected abstract void releaseForCache(T obj);
```

参照カウントなので、通常のキャッシュ機能に加え、参照数を管理する必要があります。さらにマルチスレッド環境に対応するため、どのリソースが現在データソースから取得中かも記録します（データソースからの取得は比較的時間がかかる操作です）。そのため、以下の三つのMapを用意しています。

```java
private HashMap<Long, T> cache;                     // 実際のキャッシュデータ
private HashMap<Long, Integer> references;          // リソースの参照カウント
private HashMap<Long, Boolean> getting;             // 取得中のリソース
```

`get()`メソッドでリソースを取得する際、まず無限ループに入り、キャッシュからの取得を試みます。まず他のスレッドがそのリソースをデータソースから取得中かどうかをチェックし、取得中なら少し待って再試行します。

```java
while(true) {
    lock.lock();
    if(getting.containsKey(key)) {
        // リクエストされたリソースは他スレッドが取得中
        lock.unlock();
        try {
            Thread.sleep(1);
        } catch (InterruptedException e) {
            e.printStackTrace();
            continue;
        }
        continue;
    }
    ...
}
```

もちろんリソースがキャッシュにあれば、直接取得して返します。その際、参照数を+1します。そうでなければ、キャッシュが満杯でなければ、`getting`に登録してそのスレッドがデータソースから取得を開始します。

```java
while(true) {
    if(cache.containsKey(key)) {
        // キャッシュにリソースがあるので直接返す
        T obj = cache.get(key);
        references.put(key, references.get(key) + 1);
        lock.unlock();
        return obj;
    }

    // リソース取得を試みる
    if(maxResource > 0 && count == maxResource) {
        lock.unlock();
        throw Error.CacheFullException;
    }
    count ++;
    getting.put(key, true);
    lock.unlock();
    break;
}
```

データソースからの取得は簡単で、抽象メソッドを呼び出すだけです。取得完了後は`getting`からキーを削除します。

```java
T obj = null;
try {
    obj = getForCache(key);
} catch(Exception e) {
    lock.lock();
    count --;
    getting.remove(key);
    lock.unlock();
    throw e;
}

lock.lock();
getting.remove(key);
cache.put(key, obj);
references.put(key, 1);
lock.unlock();
```

キャッシュの解放はもっと簡単で、`references`の参照数を1減らし、0になればデータソースへ書き戻し、キャッシュから関連データを削除します。

```java
/**
 * 強制的にキャッシュを解放する
 */
protected void release(long key) {
    lock.lock();
    try {
        int ref = references.get(key)-1;
        if(ref == 0) {
            T obj = cache.get(key);
            releaseForCache(obj);
            references.remove(key);
            cache.remove(key);
            count --;
        } else {
            references.put(key, ref);
        }
    } finally {
        lock.unlock();
    }
}
```

キャッシュには安全にシャットダウンする機能も必要で、シャットダウン時にはキャッシュ内のすべてのリソースを強制的にデータソースへ戻します。

```java
lock.lock();
try {
    Set<Long> keys = cache.keySet();
    for (long key : keys) {
        release(key);
        references.remove(key);
        cache.remove(key);
    }
} finally {
    lock.unlock();
}
```

これでシンプルなキャッシュフレームワークが完成しました。その他のキャッシュはこのクラスを継承し、二つの抽象メソッドを実装するだけで済みます。

### 共有メモリアレイ

ここでJavaの非常に厄介な点について触れます。

Javaでは配列はオブジェクトとして扱われ、メモリ上でもオブジェクトの形で格納されます。一方、CやC++、Goなどの言語では配列はポインタで実装されています。これが「Javaだけが真の配列を持つ」と言われる理由です。

しかし、このプロジェクトにとっては必ずしも良いニュースではありません。例えばGo言語では次のようなコードが書けます。

```go
var array1 [10]int64
array2 := array1[5:]
```

この場合、array2はarray1の5番目の要素から最後までの範囲を共有し、同じメモリ領域を参照します。配列の長さが異なっても同じメモリを共有するのです。

しかしJavaではこれが実現できません（これが高級言語なのか……）。

Javaで`subArray`のような操作をすると、内部でコピーが行われ、同一メモリを共有することはできません。

そこで、私は`SubArray`クラスを作り、この配列の使用範囲を（緩やかに）規定することにしました。

```java
public class SubArray {
    public byte[] raw;
    public int start;
    public int end;

    public SubArray(byte[] raw, int start, int end) {
        this.raw = raw;
        this.start = start;
        this.end = end;
    }
}
```

正直言って、これはあまり美しい解決策ではありませんが、現状ではこれしかありません。もし他に良い解決策を知っている方がいれば、ぜひコメント欄で教えてください。こんな醜いコードは書きたくありません/(ㄒo ㄒ)/~~