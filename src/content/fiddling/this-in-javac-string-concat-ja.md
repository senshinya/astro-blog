---
title: Javaにおけるthisキーワードがコンパイル時定数伝播最適化を無効化する問題について
tags: ["試行錯誤","java"]
lang: ja
published: 2022-04-16T00:01:28+08:00
abbrlink: fiddling/this-in-javac-string-concat
description: "Javaでは、`this`キーワードを使用すると、コンパイラによる定数の最適化が失敗することがあります。コード例では、`ab1`と`ab2`は同じfinal静的変数`s`を参照しているように見えますが、比較結果は異なります。`ab1`は静的変数を直接参照して文字列連結を行うのに対し、`ab2`は`this`キーワードを介しているため、コンパイラは同じ定数伝播の最適化を行えず、文字列比較の結果に影響を与えています。この現象は、Javaにおける微妙な文法の違いがコンパイル時の挙動に変化をもたらすことを示しています。"
---

名前が少し長くなりましたが、これはなかなか興味深い問題です。以下のコードをご覧ください。

```java
public class Test {
    final static String s = "a";

    public void test() {
        String cmp = "ab";
        String ab1 = s + "b";
        String ab2 = this.s + "b";
        System.out.println(ab1 == cmp);
        System.out.println(ab2 == cmp);
    }

    public static void main(String[] args) {
        new Test().test();
    }
}
```

まずは出力結果を予想してみましょう。7 行目の `s`と 8 行目の`this.s`はどちらも同じ final 静的変数`s` を指しています。結果がわからなくても、この 2 つの出力は同じになるはずだと思うでしょう。しかし、実際の出力は以下の通りです。

```shell
true
false
```

次に、`javap`を使って生成されたバイトコードを逆アセンブルし、`test()` メソッド部分を見てみましょう。

```shell
  public void test();
    descriptor: ()V
    flags: (0x0001) ACC_PUBLIC
    Code:
      stack=3, locals=4, args_size=1
         0: ldc           #7                  // String ab
         2: astore_1
         3: ldc           #7                  // String ab
         5: astore_2
         6: aload_0
         7: pop
         8: ldc           #11                 // String a
        10: invokedynamic #13,  0             // InvokeDynamic #0:makeConcatWithConstants:(Ljava/lang/String;)Ljava/lang/String;
        15: astore_3
        16: getstatic     #17                 // Field java/lang/System.out:Ljava/io/PrintStream;
        19: aload_2
        20: aload_1
        21: if_acmpne     28
        24: iconst_1
        25: goto          29
        28: iconst_0
        29: invokevirtual #23                 // Method java/io/PrintStream.println:(Z)V
        32: getstatic     #17                 // Field java/lang/System.out:Ljava/io/PrintStream;
        35: aload_3
        36: aload_1
        37: if_acmpne     44
        40: iconst_1
        41: goto          45
        44: iconst_0
        45: invokevirtual #23                 // Method java/io/PrintStream.println:(Z)V
        48: return
```

定数プールの `#7` は以下の通りです。

```shell
   #7 = String             #8             // ab
   #8 = Utf8               ab
```

まず最初の `true` についてですが、これは多くの方が理由を知っているはずです。コンパイラはソースコードをクラスのバイトコードに変換する際、メソッド内で使われている final 定数をリテラルに置き換えます。したがって、Java コードの 6 行目の`String ab1 = s + "b";`は`String ab1 = "a" + "b";`となり、さらに `ab1` は 2 つのリテラルを直接連結しているため、コンパイラが連結を行い、最終的にこの文は`String ab1 = "ab";`と同等になります。よって、`cmp`と `ab1` は共に定数プールの"ab"文字列を指しているため、`cmp == ab1`は `true` になります。逆アセンブルしたバイトコードの 0 行目と 3 行目は全く同じで、`ldc`（Load Constant）の引数はどちらも `#7` です。

バイトコードの 8 行目から 15 行目は `ab2`の文字列準備の過程ですが、ここでは動的メソッド呼び出しが行われており、`makeConcatWithConstants` というメソッドが呼ばれています。これは Java のブートストラップメソッドで、Java の文字列の「+」連結を処理するためのものです。このメソッドはヒープ上に新しい文字列オブジェクトを生成するため、`ab2 != cmp`となる原因です。

ちなみに、`makeConcatWithConstants`は JDK9 で導入され、文字列の「+」操作を処理するために使われています。JDK8 以前は、`javac`は `StringBuilder` クラスを使って処理していました。

では、この差異を引き起こしている原因は何でしょうか？明らかに問題は `this`キーワードにあります。Java はコンパイル時に、すべてのメンバメソッドに現在のインスタンスを指す参照`this`を暗黙的に追加します。この`this`はバイトコード上ではメソッドの引数として渡されます。これが、引数なしの`void()`メソッドであってもバイトコードの`args_size`が 1 になっている理由です。オブジェクト参照の変数（クラス変数でもメンバ変数でも）に対して、Java コンパイラは単純にこの最適化を適用しません。もしここで`this.s`を`Test.s`に変更すると、出力は`true` になります。