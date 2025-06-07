---
title: The Issue of `this` Keyword Causing Compile-Time Constant Propagation Optimization Failure in Java
tags: ["fiddling","java"]
lang: en
published: 2022-04-16T00:01:28+08:00
abbrlink: fiddling/this-in-javac-string-concat
description: "In Java, using the `this` keyword can cause the compiler’s constant optimization to fail. Although `ab1` and `ab2` in the example seem to reference the same final static variable `s`, their comparisons yield different results. `ab1` concatenates strings directly via the static variable, while `ab2` uses `this`, preventing the compiler from applying the same constant propagation optimization, thereby affecting string comparison. This phenomenon reveals how subtle syntax differences in Java can lead to changes in compilation behavior."
---
The title is a bit long, but this is indeed a rather intriguing problem. Take a look at the following code:

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

Let's try to guess the output first. Both `s` on line 7 and `this.s` on line 8 refer to the same variable—the final static variable `s`. So even if we don't know the exact result, these two print statements should logically produce the same output. But the actual output is:

```shell
true
false
```

Let's take a look at the bytecode disassembled using `javap`, focusing on the `test()` method:

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

The constant pool entry for #7 is:

```shell
   #7 = String             #8             // ab
   #8 = Utf8               ab
```

Let’s analyze the first `true` output—this should be familiar to most. When the compiler translates the source code to class bytecode, it replaces the final constants within the current class methods with their literal values. Thus, the Java code at line 6:

```java
String ab1 = s + "b";
```

effectively becomes:

```java
String ab1 = "a" + "b";
```

Since both are string literals, the compiler concatenates them at compile-time, making the statement equivalent to:

```java
String ab1 = "ab";
```

As a result, `cmp` and `ab1` both reference the same string `"ab"` in the constant pool, so `cmp == ab1` evaluates to `true`. This is why in the bytecode at lines 0 and 3, the `ldc` (Load Constant) instructions reference the exact same constant pool entry #7.

Now, lines 8 through 15 prepare the string for `ab2`. Here, we see a dynamic method invocation via `invokedynamic`, calling the method `makeConcatWithConstants`. This is a bootstrap method in Java that handles string concatenation with `"+"`. This method creates a new String object on the heap, which explains why `ab2 != cmp`—they point to different objects.

By the way, `makeConcatWithConstants` was introduced in JDK 9 to optimize string concatenation. Before JDK 9, `javac` used the `StringBuilder` class to handle `"+"` operations on strings.

So what causes this difference? Clearly, the culprit is the `this` keyword. During compilation, Java implicitly adds a reference to the current instance (`this`) in all member methods. This `this` reference is passed as a hidden parameter in the bytecode for the method. That’s why even though the method signature is `void ()`, the bytecode's `args_size` value is 1 at line 5.

For an object reference variable (whether a class variable or member variable), the Java compiler simply disables the constant propagation optimization in this context. If you replace `this.s` with `Test.s`, the output becomes `true` as expected.