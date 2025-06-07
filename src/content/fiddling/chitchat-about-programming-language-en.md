---
title: A Casual Talk on Programming Languages  
lang: en
published: 2023-04-08T13:16:36.812+08:00
tags: ["fiddling","Type Systems","Programming Languages"]
abbrlink: chitchat-about-programming-language
description: "Designing a new programming language is both a challenging and fascinating endeavor. By simplifying the complexities of compiler theory and feature implementation—and focusing on how code operates within computer systems—we gain deeper insights into the process of building programming languages. Exploring language design from the ground up based on the RISC-VI instruction set, we uncover the system’s layered structure and the concept of virtual machines. This journey is not just a technical exploration, but also a profound reflection on the true nature of programming languages."
---
This article popularizes some basic concepts, implementation ideas, and current trends in programming language theory by discussing the process of designing a language of our own.

### Am I…Going to Design a Programming Language?

Let’s imagine we’re about to design a brand new programming language: C--.

Yes, that’s right—we’re designing it ourselves.

We’ll set aside the nitty-gritty details of compiler theory, compiler and interpreter implementation, and not get bogged down discussing the specifics of various features (after all, the title says “casual talk”!).

Let’s build our own language from the ground up.

We’ll start by assuming that the final compiled output of our language is in RISC-VI format, paired with a corresponding RISC-VI instruction set. This assembly language is extremely basic—it can only perform simple operations on memory and registers.

### Where Does the Code Run?

This question might seem more about the RISC-VI instruction set or architecture, unrelated to the high-level features we’re looking to design. But it actually matters—your code exists at a certain layer of the computer system, and that’s something every language designer must consider:

> At its core, a computer system is a stack of layered virtual machines.

In this tiered virtual machine model, each higher layer wraps and abstracts the operations of the lower layer, while adding its own features for the layer above.

For example, the operating system acts as a virtual layer over the hardware (bare metal). Say your computer runs on the x86 instruction set—when you compile a C program into a binary and execute it, the OS first parses the binary format (if it's Linux, that's probably ELF). After parsing, the OS loads various segments of the binary into memory and jumps to the entry point in the code section to start execution. In reality, of course, things are more complex: the OS manages memory in sophisticated ways, isolates tasks using processes, etc.

Interestingly (or perhaps not coincidentally), C-compiled binaries can run not just at the OS layer, but directly on bare metal. A classic example: the Linux kernel is mostly written in C (though Rust is now joining the mainline—exciting times ahead). At the system programming level, C programs mostly rely on system calls provided by the OS. For example, on x86 Linux, if a program wants to read data from a file, it typically invokes the sys_read system call. The OS takes care of actually reading the file, along with all the necessary permission checks. But if you’re writing an OS in C, you obviously can’t rely on system calls—there may not even be a concept of “files” yet! In that case, you have to interact directly with hardware controllers (e.g., disk controllers) to achieve even simple data reads.

All this illustrates how the operating system perfectly fits the definition of a virtual machine. One could even say Linux is a virtual machine for running ELF binaries (though it does much more than that). Ignoring standard libraries provided by the OS, C is a language that targets the bare metal layer (well, strictly speaking, it’s the compiled output running there, but let’s not nitpick).

Let’s take another example: Python. Python is a classic interpreted language. Its reference implementation, CPython, is written in C. In our layered model, CPython is a virtual machine built on top of the operating system—it wraps OS interfaces for Python programs to use.

In fact, even C—a compiled language—can almost be considered interpreted: the CPU fetches, parses, and executes instructions one by one—they just happen to be in binary. For Python, those instructions are human-readable, and CPython takes them as strings.

A huge advantage of interpreted languages is portability: the interpreter abstracts away OS-level differences and presents the same API to the high-level language, enabling code to “write once, run anywhere.” Of course, this just shifts the burden onto the interpreter’s developers. Even compiled languages, though, require different compilers for different architectures—nobody gets a free lunch!

Speaking of “write once, run anywhere,” that brings us to Java, the poster child of “compile once, run anywhere.” Java combines compilation and interpretation. The JVM is to Java what CPython is to Python—a runtime environment. Java files are compiled into class files; the JVM’s input format is class, not human-readable source or machine code. This class file format is consistent across OS and architectures, which is why you can run a class file compiled on x86 on a JVM on RISC-V. The JVM loads and interprets these class files, just like an interpreter, executing them instruction by instruction. So it’s hard to pin down whether Java is truly compiled or interpreted—it’s both.

The JVM is a tremendously successful virtual machine. It not only supports Java, but also runs many other languages like Scala and Groovy—as long as they can compile to class files.

We often say: interpreted languages are slower, and compiled languages are faster. But language evolution has blurred this distinction. Many interpreted languages now introduce features to speed up execution. Take Java again: during interpretation, the JVM dynamically spots "hot code", compiles it to native machine code, and next time just runs that binary directly. This is called JIT (Just-in-time compilation). Python’s numba library does similar JIT magic.

Of course, if you wrote a C interpreter, you could claim C was an interpreted language too! (Just kidding… or am I?)

### Type Systems

We’ve now settled C--’s runtime position, but so far, our language is painfully minimal—it hardly exists at all.

- If we go the compiled language route, RISC-VI as an instruction set is generally agnostic to high-level language features.
- If we go interpreted, maybe we’d design both RISC-VI and its interpreter ourselves.

RISC-VI’s assembly can only operate on memory and registers. From its perspective, memory and registers are just meaningless arrays of bytes, and you can fiddle with any byte (within the constraints of the lower VM layer).

Suppose our language had no type system—everything is just raw bytes. In C-like terms, you’d never declare any types; you’d just use void* pointers to poke at any memory. All you could do is take addresses, dereference, and assign bytes—no different from writing assembly directly! Creating a 4-byte integer on the heap and assigning it the value 1 would look like this (C syntax, but actually type-less, just like assembly):

```c
void *intBytes = malloc(4);    // allocate 4 bytes on the heap
*(intBytes+3) = 0x01;          // assuming big-endian, set the 4th byte to 1
```

Where did our familiar int, float, etc. go? That's exactly what a type system gives us.

> At its core, a type is a way to interpret a block of memory.

A type system carves up the undifferentiated heap space into meaningful chunks, giving them interpretation rules. For programmers, types are most obvious in syntax—for example, in C, int usually means a 4-byte integer; double means a double-precision IEEE 754 float. Types influence how the compiler generates machine code to operate on these bytes at runtime.

With a type system, initializing a 4-byte integer changes to:

```c
int *intBytes = (int *)malloc(4);
*intBytes = 1;
```

By declaring intBytes as a pointer to int, we’re telling the compiler to interpret the pointed-to memory as an integer. Assigning 1 is safe and does what we expect; the compiler knows how to handle the internals. Although the machine code still sets the appropriate byte, it’s the compiler that makes the magic—and we just work with familiar types.

An interesting point: C compilers optimize pointer arithmetic at compile time. For instance, `intBytes+1` means “4 bytes past intBytes” because int occupies 4 bytes. This underpins arrays in C.

> For C, the type system is a compile-time feature.

Structs are the same idea: they guide the compiler on memory manipulation. For example:

```c
typedef exampleStruct struct {
    int a;
    int b;
}
```

This struct is 8 bytes. If we declare a pointer `esp` to exampleStruct, it just means that this memory and the next 8 bytes are to be understood as two ints. Accessing esp->b means accessing the 5th to 8th bytes as an int.

You could say: in runtime, struct members are just offsets from the struct’s base address.

If you instead declare `exampleStruct esp;` on the stack, it’s really just compiler sugar: the compiler places the struct in the stack frame ahead of time and frees it automatically—once the function ends, the stack pointer moves back (the stack grows downward), making reuse of memory safe and simple.

Of course, stack allocation’s pros come with cons—you lose access to that memory outside the function.

Java’s type system is much more restricted: type information is embedded with objects in memory, and casts can only happen between parent and child in the type tree.

#### Pass-by-Value or Pass-by-Reference?

Here’s a classic discussion and source of bugs: are function arguments passed by value or by reference?

At heart, all function arguments are passed by value; so-called reference passing is really just smarter value passing.

C is straightforward: whether through registers or the stack, data is copied or backed up to ensure isolation. Passing a pointer really just passes some numeric value (either 32 or 64 bits), same as assigning it to a long and passing that.

Java is where reference passing comes up most. A reference is really a handle to an object, enabling access to some of its info. It’s not the memory address itself, but it always includes it. When a reference is passed to a function, you’re essentially passing a struct that contains the real memory address—just like passing a pointer in C.

Yet Java has eight basic types, plus their wrapper classes, and the implementation is pretty inconsistent—it’s said these were designed to lure C++ programmers, but it’s definitely not elegant.

### What is an Array?

With a type system, it’s time to tackle a special but common structure: arrays. But what are arrays—do they really exist?

At runtime, C doesn’t have "arrays"—they’re a compile-time convenience. Arrays in C are implemented atop pointers. The array name is just the address of the first element. If you declare `int a[10]`, then `a` is identical to `&a[0]`. The bracket notation (indexing) is pointer offsetting based on type. `a[1]` is the same as `*(a+1)`. More specifically:

```c
int b = a[0];

// Equivalent to
void *p = (void *)a;
p += 4;
int b = *((int *)p);
```

Because arrays are implemented as type pointers and can freely interconvert, C provides no language-level bounds checking. If you declare an on-stack array of length 10, reading or writing the 11th element sometimes works with no errors.

But, wait—doesn’t array overflow cause a segment fault? That’s not C doing the check—it’s the OS protecting unreadable/unwritable memory. The language never checks.

C supports three ways to pass arrays as parameters: pointer, fixed-size array, and size-unspecified array:

```c
void func(int *array);
void func(int array[10]);
void func(int array[]);
```

It’s worth noting: for the first and third ways, the callee can’t recover the original length; for the second, the length always appears as 10—even if the real array isn’t. The length is part of the type, and passing arrays this way loses size information, fitting with the pointer-based nature of arrays: what’s in memory is just the elements themselves, nothing else.

Contrast this with Java: arrays are real objects. Every array is an object, with metadata like base type and length right in the header. Thus, Java can check bounds at runtime and throw IndexOutOfBoundsException.

### Procedural or Object-Oriented?

This isn’t so much a question—broadly speaking, object-oriented and procedural programming are philosophies and paradigms, not just features of a language. C can be used "object-style" via structs, too.

If we define narrowly: only languages that natively and fully support the Big Three—encapsulation, inheritance, and polymorphism—are true object-oriented languages.

Encapsulation is straightforward—even C can wrap data in structs. But true encapsulation means hiding internal details and exposing only approved interfaces. In C, structs have no access control; anyone can poke into their fields, so it’s a weak form of encapsulation. Languages like Java, C++, or Go let you call a struct/object’s "methods" with dot notation, but under the hood, member methods are just functions where the first argument is a pointer to the object (this), and the compiler fills in the details.

Java, C++, and Go all use composition to realize inheritance. In Go, it’s clearest: embedding a parent struct into a child struct makes the parent’s fields accessible via the child, basically just syntactic sugar. For example:

```go
type Parent struct {
	a int64
}

type Child struct {
	Parent
	b int64
}

c := &Child{Parent{}, 0}
a := c.a
// or
a := c.Parent.a;
```

Go’s inheritance is more like play-acting—there’s no parent-child access control, and exported fields are governed only by uppercase/lowercase names, with no "protected" like in Java.

Polymorphism means: when a parent pointer refers to different child objects, calling a shared method will invoke child-specific behaviors. Java and C++ implement polymorphism in different (classic) ways. Java, with its runtime (JVM), makes this easy: the handle leads to all necessary info for dynamic method dispatch. C++ uses a virtual function table in each class; objects point to their vtable. The compiler guarantees overridden functions align in the table, so calls boil down to “call the Nth entry in the vtable.” Thus, a parent pointer can invoke a child’s implementation.

### How are Generics Implemented?

Thanks to modern IDEA-style auto-completion, generics are now among the most widely used high-level language features. Yet, Java didn’t get generics until JDK 5, and C++ had to wait for templates in C++11—both pretty recent. Interestingly, each language represents a radically different approach to generics.

Java’s generics exist only at compile time—they’re erased at runtime (so-called type erasure). This means generics are for compile-time type checking only: your code is checked against type parameters at compile time. If you bypass these checks (say, by constructing a class file manually or using reflection), the JVM can’t help you. For example, if you declare `List<String>`, normally you can only add Strings. But due to type erasure, at runtime it’s actually just a `List`, so you could sneak an Integer in—and the JVM won’t complain.

C++ implements generics via code generation (templates). The compiler tracks every unique instantiation of a template and generates code for each combination of parameters—so if you define a `ClassName<typename T>` with a method `Test(T t)`, and instantiate it with `ClassName<int>`, then actual code for `Test(int t)` exists after compilation. Like Java, runtime doesn’t see type-specific info, but C++’s code generation is stricter, making it safer: type-safety is guaranteed, and there’s no way to sneak past checks by bypassing the compiler.

A downside is that in C++, for each type parameter, the entire class is generated anew, code and all—even if there are no type-dependent methods—leading to code bloat. C# improves on this: it generates shared machine code for each generic class at JIT time, storing specialized type info elsewhere, so code can be reused across types. (See academic sources for more details.) C++ can’t get away with this without its own runtime.

### Conclusion

Once you’ve sorted out all of these components, you’ve basically decided what your language will be—even before you even think about syntax! The rest is implementation details—get coding!

Of course, you’re free to sprinkle in advanced features—garbage collection, sophisticated lifetime management, whatever you want. Having a VM makes fancy features easier, but it’s not required: for example, Go bakes GC directly into the final binary, so every binary comes with its own “mini VM.”

Most people don’t need to implement their own languages, but understanding the commonalities and differences between programming languages is invaluable. There’s no "best" language—only the best language for a particular scenario. That’s why debates over "the best language" are so silly: every language was designed to solve some problem. If a new language brings no new features, why bother learning it?

And, as a side benefit—next time you're at a programmer get-together, or the “which language is best?” debate pops up in a tech group—you’ll have plenty to talk about.