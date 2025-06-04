---
title: RISC-V 工具链与模拟器（emulator）的安装
published: 2023-05-24T17:51:09.461+08:00
tags: ["折腾","环境搭建", "riscv","spike","riscv-pk"]
description: "在安装 RISC-V 工具链时，首先需要获取 riscv-gnu-toolchain 的源码，建议使用带有 `--depth=1` 的 clone 命令，以减少下载体积。安装过程中，注意查看 README 中的 Prerequisites 部分，确保前置依赖都已正确安装。在 Debian 系统中，可以通过简单的命令安装所需的依赖包，确保工具链的顺利搭建。"
---
闲的无聊看看 spike 源码，但是翻了很多教程都没有可以直接安装好 spike 和相关的工具链。于是自己动手丰衣足食，直接读相关仓库的 README，基本都可以安装成功，但是还是暗藏着一个小坑，记录一下。

### 工具链（riscv-gnu-toolchain）的安装

RISC-V 工具链包括 gcc、gdb、objdump/copy 和相关的标准库实现等，建议首先安装。

仓库地址：https://github.com/riscv-collab/riscv-gnu-toolchain

clone 时建议加上 `--depth=1` 参数缩小 clone 体积，后面几个仓库的 clone 也建议加此参数。

前置的依赖安装可见 README 中的 Prerequisites 一节，当前 Debian 系下为：

```bash
sudo apt install autoconf automake autotools-dev curl python3 libmpc-dev libmpfr-dev libgmp-dev gawk build-essential bison flex texinfo gperf libtool patchutils bc zlib1g-dev libexpat-dev ninja-build
```

clone 后按照工具链中的 `Installation (Newlib)` 一节基本可以安装成功，但是有坑点：

> 使用此方式编译的 gcc 无法编译 riscv-pk，会报 extension `zifencei' required 的错误，推测是因为默认的编译参数并不支持 zifencei 扩展（即 FENCE.I 指令）

可用的编译参数如下：

```bash
./configure --prefix=/opt/riscv --with-arch=rv64gc
make
```

建议首先在 /opt 下建立 riscv 文件夹，并保证 riscv 文件夹的所有人为普通用户自己。如非则需要 chown：

```bash
sudo chown 1000:1000 /opt/riscv
```

这里假设 uid 和 gid 皆为 1000，具体可以通过 `id` 命令查看。

安装完成后需要将 `/opt/riscv/bin` 加入 Path，具体方式可 Google 可 ChatGPT。后续安装的内容也都会放入 `/opt/riscv` 中。完成后 `riscv64-unknown-elf-gcc` 应当可用。

### 模拟器（spike）的安装

仓库地址：https://github.com/riscv-software-src/riscv-isa-sim

clone 下来后按照 README 中的 Build Steps 一节直接安装即可，并无坑点。当前命令：

```bash
$ sudo apt install device-tree-compiler
$ mkdir build
$ cd build
$ ../configure --prefix=/opt/riscv
$ make
$ make install
```

安装完成后 `spike` 命令应可用

### 模拟内核（riscv-pk）的安装

仓库地址：https://github.com/riscv-software-src/riscv-pk

pk 即 Proxy Kernel，用来直接运行静态链接的用户态 RISCV 程序，毕竟只要验证的话，再跑一个操作系统太重了。

clone 下来后按照 README 中的 Build Steps 直接安装即可。坑点仅限于工具链一节提到的 FENCE.I 指令。当前命令：

```bash
$ mkdir build
$ cd build
$ ../configure --prefix=/opt/riscv --host=riscv64-unknown-elf
$ make
$ make install
```

### 验证

验证使用了 spike 中的例子。新建 hello.c，内容如下：

```c
#include <stdio.h>

void main()
{
    const char *s = "Hello.\n";
    while (*s) putchar(*s++);
    while(1);
}
```

编译该文件：

```bash
$ riscv64-unknown-elf-gcc -o hello hello.c
```

通过 spike 运行：

```bash
spike pk hello
```

可以看到终端输入了 Hello.，按多次 ctrl+c 可退出。