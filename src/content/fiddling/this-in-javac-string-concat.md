---
title: Java 中 this 关键字导致编译期常量传播优化失效的问题
tags: ["折腾","java"]
published: 2022-04-16T00:01:28+08:00
description: "Java 中 this 关键字如何影响编译期常量传播优化。"
---
名字起的有点长了，但是这确实是个挺有趣的问题。如下代码：

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

我们先来猜一猜输出结果，第 7 行的 s 和第 8 行的 this.s 都是指的同一个变量，就是那个 final 静态变量 s。那么就算我们不知道结果，这两个输出应该也是一样的。但实际上的输出是

```shell
true
false
```

我们先用 javap 将生成的字节码反汇编出来，test() 部分如下：

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

常量表中的 #7 为：

```shell
   #7 = String             #8             // ab
   #8 = Utf8               ab
```

我们先来看第一个 true，这个大家应该基本都知道原因。编译器在将源码编译为 class 字节码文件时，会将当前类的方法中出现的 final 常量替换为字面量，于是 Java 代码第 6 行的 `String ab1 = s + "b"`; 就变为 `String ab1 = "a" + "b"`;，进一步，由于 ab1 是由两个字面量直接拼接的，编译器就直接帮其完成拼接，最终的结果，这条语句等价于 `String ab1 = "ab";`。于是 cmp 和 ab1 都指向常量池的"ab"字符串，所以 cmp == ab1。反汇编的字节码中，第 0 行和第 3 行是完全一样的，ldc（Load Constant）的参数都是 #7。

字节码的 8~15 行是准备字符串 ab2 的过程，可以看到这里执行了一个动态方法调用，调用的是方法 makeConcatWithConstants，这个方法是 Java 的一个引导方法，用于处理 Java 中对 String 进行 “+” 拼接。这个方法会在堆中创建一个新的字符串变量，这就是 ab2 != cmp 的原因。

BTW，makeConcatWithConstants 这个方法在 JDK 9 中被引入用于处理字符串“+”操作，在 JDK 8 之前，javac 一直是用 StringBuilder 类来处理的。

那么是什么导致了这个差异呢？显然，问题在这个 this 关键字上。Java 在编译时，会隐式在所有成员方法中添加一个指向当前实例的引用 this，这个 this 在字节码中是作为方法参数传递给方法的，这就是为什么void() 方法没有参数，字节码第五行中 args\_size 却等于 1。对于一个对象引用的变量（无论是类变量还是成员变量），Java 编译器仅仅是很粗暴地关闭了这个优化。如果将这里的 this.s 改为 Test.s，那么这里输出的结果就是 true 了。