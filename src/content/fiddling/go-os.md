---
title: 一次失败的项目实践——春节七天乐（不起来）
tags: ["折腾","golang", "os", "riscv"]
published: 2023-02-02T23:24:55+08:00
description: "在一次春节假期中，灵感悄然降临。高铁上偶然阅读了关于在裸机上运行Go程序的文章，激发了对底层系统接口的探索欲望。作者的成功实践和实现，让人对将高级语言与操作系统结合的可能性感到兴奋。随着对相关研究的深入，发现这一概念早已有先例，这股热情在潜移默化中积聚，最终演变成了一场充满期待却未能如愿的项目实践。"
---
### 缘起

最初是在过年回家的高铁上，在知乎上看到了这篇文章：[将Go程序跑在裸机上](https://zhuanlan.zhihu.com/p/265806072)，大致想法是通过实现一遍系统接口，来接管 golang 程序的各种系统调用和中断之类的。感觉这个想法十分有趣。作者还用 golang 写了一个 x86 os：[eggos](https://zhuanlan.zhihu.com/p/265806072)，完成度相当之高。由于是从底层魔改了 golang 的运行时，用户程序完全无感知，所以各种 golang 的第三方库都可以直接使用。作者甚至实现了一个支持 TCP/IP 的协议栈，使得一些网络库可以直接使用。看的我心潮澎湃。

搜了搜一些前人的工作，发现这个想法很早就被人提出来过。2018 年 OSDI 会议上就有一篇论文，讲述了使用高级语言实现操作系统的好处和代价，幻灯片在[这儿](https://www.usenix.org/sites/default/files/conference/protected-files/osdi18_slides_cutler.pdf)。另外，相关的实现这几年也是有的，比如 [gopher-os](https://github.com/gopher-os/gopher-os)，一个验证性质的内核，只是为了证明使用 golang 实现操作系统是可行的。另外还有 MIT 的一个博士论文项目 [Buscuit](https://github.com/mit-pdos/biscuit)，思路是 hack 编译器使得能够编译到裸机，这个项目完成度更高，实现了部分 POSIX 接口，甚至可以在上面跑 redis 和 nginx。

在研究资料过程中，发现了一个共同点：都是基于 x86 架构实现的。我之前用 c 写过一个小内核，是基于 RISC-V 架构，RISC-V 的汇编和各种机制都十分简单，写起来也很舒服。于是就有了这么个想法：用 go 实现一个 RISC-V 的操作系统。

说干就干！到家第二天就开始搞起来了。

### 就是干！

做一个项目，很重要的一点，就是起名字（bushi

但我确实首先想到了一个绝妙的名字：goose

![README](https://blog-img.shinya.click/2025/736f6c389e54c1327775f1aa95dad597.png)

太妙了兄弟们！

首先 go 是原生支持交叉编译到 RISC-V 64 位的可执行文件的，这是好事。只需要在 go build 命令之前加上 `GOOS=linux GOARCH=riscv64` 即可，非常方便。

虚拟机照例使用的是 qemu，平台还是 virt。virt 平台的内存布局：0x80000000 以上是物理内存区域，0x80000000 以下是 mmio 区域（大概就是把设备的内存映射到了这片区域，操作这块内存等同于操作这个设备）。virt 启动时会把 pc 设置为 0x80000000

然而正常编译的 go 可执行文件，由于运行在用户态虚拟地址上，entry 的地址都是低地址，大概 0x10000 左右。好在 go 提供了一个链接标志 `-T` 来指定 TEXT 段的起始地址，可以用这个标志把整个代码段放在高地址内存处，同时还可以通过 `-E` 来指定入口的标志，这样就可以写一个函数来接管 go 的启动过程（go 程序的入口不是 main 函数，而是 `_entry` 函数，这个函数用来做一些初始化工作）

然而还有一个严重的问题：我们指定了入口函数，但是没有办法指定这个函数的起始地址，就没法把这个函数放到 0x80000000 处，virt 在启动的时候，0x80000000 就可能是一堆啥也不知道的代码。通常，如果是 c，我们可以通过编写链接脚本来解决这个问题，而且非常简单：直接指定好入口标记的地址，一行就完事。可是这是 go。

在查了一些资料后，在 stackoverflow 上看到了这个[提问](https://stackoverflow.com/questions/69111979/using-custom-linker-script-with-go-build)，使用外部链接器而非 go 自己内置的链接器，这样就可以指定链接脚本了。但是尝试了下之后，不太可行。go 的可执行文件中除了一些已知的 text 段、bss 段、rodata 段和 data 段，还有一些自己的乱七八糟的段，这些都必须在链接脚本里显式指定，几乎不太可能。

于是更换思路，入口可以写一段 c 代码，这段 c 代码动态获取 go 代码的入口然后跳转过去。由于 go 代码的入口只存在于 elf 文件中，在加载后的内存映像中是没有这个信息的。所以可以把这个 elf 文件直接以二进制的形式链接到 c 程序的 data 段，可以为这段保存二进制的内存开始和结尾指定一个名字，我是用的是 `_binary_kernel_elf_start` 和 `_binary_kernel_elf_end`。这样在 c 代码中就可以快速找到了。而 c 代码的作用，就是解析这段内存中保存的 elf 文件，把需要载入内存的段复制到内存对应的地址处，再跳转到 elf 指定的 entry 处即可。

这里贴一下入口的汇编代码，大概就是设置好栈就跳转进 c 函数中，同时指定了 data 段中的两个符号间的一段内存是编译好的 go 可执行文件：

```asm
    .section .text.entry
    .globl _start
    # 仅仅是设置了 sp 就跳转到 main
_start:
    la sp, bootstacktop
    call bootmain

# 启动线程的内核栈 bootstack 放置在 bss 段的 stack 标记处
    .section .bss.stack
    .align 12
    .global bootstack
bootstack:
    # 以下 16K 字节的空间作为 OS 的启动栈
    .space 0x4000
    .global bootstacktop
bootstacktop:

    .section .data
    .globl _binary_kernel_elf_start
    .globl _binary_kernel_elf_end
_binary_kernel_elf_start:
    .incbin "kernel.elf"
_binary_kernel_elf_end:
```

C 函数 bootmain 也十分简单，解析 elf 文件，读取程序头表，把各个段都加载到需要的物理内存处：

```c
void
bootmain()
{
    struct elfhdr *elf;
    struct proghdr *ph, *eph;
    void (*entry)(void);
    uchar *pa;
 
    elf = (struct elfhdr *)(_binary_kernel_elf_start);
 
    if (elf->magic != ELF_MAGIC)
        return;
 
    ph = (struct proghdr *)((uchar *)elf + elf->phoff);
    eph = ph + elf->phnum;
    for (; ph < eph; ph++)
    {
        pa = (uchar *)ph->paddr;
        readseg(pa, ph->filesz, ph->off);
        if (ph->memsz > ph->filesz)
            clearMem(pa + ph->filesz, ph->memsz - ph->filesz);
    }
 
    entry = (void (*)(void))(elf->entry);
    entry();
}
```

最后 entry 的位置就是从 elf 头中读出来的 go 入口函数地址，跳转过去即可。

go 入口函数是 rt0 函数，是一个汇编函数。go 使用的汇编格式是 PLAN9 汇编，起源于一个上古操作系统 plan9。这个格式的汇编支持多个指令集架构，但是很神奇的是找不到任何官方的文档描述不同的指令集架构中这个格式的汇编支持哪些指令。x86 的还能找到点资料，因为 PLAN9 汇编的例子基本是 x86 的，RV64 则是一点痕迹都没有，完全靠猜（

通过各种摸索，最后终于写出了入口：

```asm
#include "textflag.h"

TEXT ·rt0(SB),NOSPLIT|NOFRAME,$0
    CALL ·kernelStackTop(SB)
    MOV  0(SP), A1
    MOV  A1, SP
    CALL ·kmain(SB)
    UNDEF
    RET
```

这个格式也蛮阴间的……做的事情基本一致，调用 kernelStackTop 获得预先分配好的栈顶地址，并把 SP 指针指向那个地址，随后就调用 go 语言的入口了：kmain。唯一的 go 文件写得也很简单：

```go
type stack [16 * 4096]byte

type virtualAddress uintptr

var (
    kstack stack
)

//go:nosplit
func (s *stack) top() virtualAddress {
    stackTop := uintptr(unsafe.Pointer(&s[0])) + unsafe.Sizeof(*s)
    // Align to 16 bytes.
    stackTop = stackTop &^ 0xf
    return virtualAddress(stackTop)
}

//go:nosplit
func kernelStackTop() uint64 {
    return uint64(kstack.top())
}

//go:nosplit
func rt0()

//go:nosplit
func kmain() {
    for {
    }
}
```

预先分配了 stack 数组作为内核栈，kmain 啥也没干，就是无限循环。注意每个函数都有一个编译标识：`//go:nosplit`，表示让编译器不要插入检查这个函数的是否会栈溢出的代码，同时还有一个隐式的用途：阻止编译器在函数中插入 gc 检查点。如果触发了 gc，以现在这个啥也没有的裸机，gc 是完全不支持的（当然 gc 也不应该在内核中跑，更多的处理用户空间的堆）

这样 Makefile 就可以这样写了：

```make
Image: kernel.elf
    $(CC) $(CFLAGS) -fno-pic -O -nostdinc -I. -c boot/boot.c
    $(CC) $(CFLAGS) -fno-pic -nostdinc -I. -c boot/boot_header.S
    $(LD) $(LDFLAGS) -T image.ld -o Image boot.o boot_header.o

kernel.elf:
    GOOS=linux GOARCH=riscv64 go build -o kernel.elf -ldflags '-E goose/kernel.rt0 -T 0x80200000' -gcflags "-N -l" ./kmain
```

kernel.elf 编译 go 的 elf 文件，指定入口函数为 goose/kernel.rt0，TEXT 段的起始地址为 0x80200000。而 Image 则是编译了上面说的加载内核的入口代码，image.ld 中指定了将入口函数放在 TEXT 段的入口，并把 TEXT 段放在 0x80000000 位置。

```plain
/* 执行入口 */
ENTRY(_start)

/* 数据存放起始地址 */
BASE_ADDRESS = 0x80000000;

SECTIONS
{
    /* . 表示当前地址（location counter） */
    . = BASE_ADDRESS;

    /* start 符号表示全部的开始位置 */
    kernel_start = .;

    text_start = .;

    /* .text 字段 */
    .text : {
        /* 把 entry 函数放在最前面 */
        *(.text.entry)
        /* 要链接的文件的 .text 字段集中放在这里 */
        *(.text .text.*)
    }
    ...
}
```

妥！

因为兴趣很大，整个春节我亲戚都没有走好，整天就是憋在屋里收集资料，在外面也是发呆想思路，魔怔了一样。

### 大失败

噔噔咚！

在把内核加载到 qemu 开始运行后，debug 看到卡死在把程序段加载到内存中。于是用 readelf 检查了一下 go build 出来的 elf 文件，发现了这个诡异的东西

```bash
Type           Offset             VirtAddr           PhysAddr
                 FileSiz            MemSiz              Flags  Align
  PHDR           0x0000000000000040 0x00000000801ff040 0x00000000801ff040
                 0x0000000000000188 0x0000000000000188  R      0x10000
  NOTE           0x0000000000000f9c 0x00000000801fff9c 0x00000000801fff9c
                 0x0000000000000064 0x0000000000000064  R      0x4
  LOAD           0xffffffffffff1000 0x00000000801f0000 0x00000000801f0000
                 0x0000000000063300 0x0000000000063300  R E    0x10000
  LOAD           0x0000000000060000 0x0000000080260000 0x0000000080260000
                 0x000000000006adb8 0x000000000006adb8  R      0x10000
  ...
```

注意第三段的 Offset 是 0xffffffffffff1000 这个大的吓人的数。Offset 是这个段的内容在文件中存放的位置相对于文件开头的偏移。这个 elf 文件才几十 KB，哪来这么大的偏移？即使加载到内存中，virt 计算机的默认物理内存大小也只有 128 MB，直接炸裂

百思不得其解，于是开始试验起来，最后发现，只要加上 `-T` 这个链接参数，就会出现这种情况。但是不加又不行，这些内存段不能被加载到低地址上，因为那是 mmio 的位置。于是我去 go 的 github 仓库里发了个 issue：[cmd/link: wrong program header offset when cross-compile to riscv64 when setting -T text alignment](https://github.com/golang/go/issues/57983)。描述了一下后，得到的回答是：

![ISSUE](https://blog-img.shinya.click/2025/42c633b821d4323697e542b47a8fce31.png)

看来是 RV64 对 `-T` 的支持不太完善……

于是这个项目就被搁置到了现在，可惜了我想的好名字/(ㄒoㄒ)/ 只能期待后续 go 官方能修复这个问题，但是感觉 go 对 RV64 不是很上心，原生支持交叉编译到 RV64 也是近几年才合进主线的……

很气，转投 Rust 去了！