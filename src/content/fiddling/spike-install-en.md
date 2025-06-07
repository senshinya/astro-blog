---
title: Installing the RISC-V Toolchain and Emulator
lang: en
published: 2023-05-24T17:51:09.461+08:00
tags: ["fiddling", "environment-setup", "riscv", "spike", "riscv-pk"]
abbrlink: fiddling/spike-install
description: "When installing the RISC-V toolchain, it’s best to start by obtaining the riscv-gnu-toolchain source code. Using the `--depth=1` option when cloning helps reduce download size. Make sure to review the Prerequisites section in the README to ensure all dependencies are properly installed. On Debian systems, installing required packages is straightforward, which ensures a smooth setup of the toolchain."
---
Out of boredom, I decided to take a look at spike’s source code. After browsing through many tutorials, none provided a straightforward way to install spike and its related toolchain. So, I took matters into my own hands and dove into the repositories’ READMEs. Generally, installation is smooth, but there was a minor gotcha I encountered—here’s a note for reference.

### Installing the Toolchain (riscv-gnu-toolchain)

The RISC-V toolchain includes gcc, gdb, objdump/copy utilities, and related standard library implementations. It’s recommended to install this first.

Repository URL: https://github.com/riscv-collab/riscv-gnu-toolchain

When cloning, it’s advisable to add the `--depth=1` flag to reduce clone size. This applies similarly to subsequent repositories you clone.

Dependencies are listed in the Prerequisites section of the README. For Debian systems, install them via:

```bash
sudo apt install autoconf automake autotools-dev curl python3 libmpc-dev libmpfr-dev libgmp-dev gawk build-essential bison flex texinfo gperf libtool patchutils bc zlib1g-dev libexpat-dev ninja-build
```

After cloning, follow the `Installation (Newlib)` section in the toolchain repo to build. However, there’s a catch:

> The gcc compiled this way cannot compile riscv-pk; it reports an error about the `zifencei` extension being required. Presumably, the default compile settings do not enable the zifencei extension (the FENCE.I instruction).

A working configure command is:

```bash
./configure --prefix=/opt/riscv --with-arch=rv64gc
make
```

It’s recommended to create a `riscv` directory under `/opt` first and ensure it is owned by your user. If not, change ownership accordingly:

```bash
sudo chown 1000:1000 /opt/riscv
```

(Here, it’s assumed your user’s uid and gid are both 1000; you can check via the `id` command.)

Once installed, add `/opt/riscv/bin` to your PATH (a quick web search or ChatGPT can help with this). Subsequent tools will also be installed under `/opt/riscv`. After completion, the command `riscv64-unknown-elf-gcc` should be available.

### Installing the Emulator (spike)

Repository URL: https://github.com/riscv-software-src/riscv-isa-sim

Clone the repo, then follow the Build Steps section in the README. No pitfalls here. Current installation commands:

```bash
$ sudo apt install device-tree-compiler
$ mkdir build
$ cd build
$ ../configure --prefix=/opt/riscv
$ make
$ make install
```

After installation, the `spike` command should be ready to use.

### Installing the Proxy Kernel (riscv-pk)

Repository URL: https://github.com/riscv-software-src/riscv-pk

The Proxy Kernel (pk) directly runs statically linked user-mode RISC-V programs. This is handy for testing, as running a full OS just for verification can be overkill.

Clone the repo and follow the README’s Build Steps. The only caveat is the FENCE.I instruction mentioned in the toolchain section. Typical installation commands are:

```bash
$ mkdir build
$ cd build
$ ../configure --prefix=/opt/riscv --host=riscv64-unknown-elf
$ make
$ make install
```

### Verification

I tested using the example from spike. Create a `hello.c` file with the following content:

```c
#include <stdio.h>

void main()
{
    const char *s = "Hello.\n";
    while (*s) putchar(*s++);
    while(1);
}
```

Compile it with:

```bash
$ riscv64-unknown-elf-gcc -o hello hello.c
```

Run it through spike:

```bash
spike pk hello
```

You should see "Hello." output to the terminal. Pressing Ctrl+C multiple times will exit.