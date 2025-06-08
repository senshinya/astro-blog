---
title: RISC-V ツールチェーンとエミュレーター（emulator）のインストール
lang: ja
published: 2023-05-24T17:51:09.461+08:00
tags: ["試行錯誤","環境構築", "riscv","spike","riscv-pk"]
abbrlink: fiddling/spike-install
description: "RISC-V ツールチェーンをインストールする際、まず riscv-gnu-toolchain のソースコードを取得する必要があります。`--depth=1` オプションを付けて clone することを推奨し、ダウンロードサイズを削減できます。インストール中は README の Prerequisites セクションをよく確認し、前提となる依存関係が正しくインストールされていることを確認してください。Debian システムでは簡単なコマンドで必要な依存パッケージをインストールでき、ツールチェーンの構築をスムーズに行えます。"
---
暇つぶしに spike のソースコードを覗いてみたのですが、多くのチュートリアルを見ても spike と関連ツールチェーンを直接インストールできるものは見当たりませんでした。そこで自分で手を動かして環境を整え、関連リポジトリの README を読みながら基本的にはインストールに成功したものの、ひとつ小さな落とし穴があったので記録しておきます。

### ツールチェーン（riscv-gnu-toolchain）のインストール

RISC-V ツールチェーンには gcc、gdb、objdump/copy、関連する標準ライブラリの実装などが含まれており、まずはこちらをインストールすることをおすすめします。

リポジトリURL：https://github.com/riscv-collab/riscv-gnu-toolchain

clone する際は `--depth=1` オプションを付けてクローンサイズを小さくすることを推奨します。以降のリポジトリも同様にこのオプションを付けることをおすすめします。

前提となる依存関係のインストールは README の Prerequisites セクションに記載されており、現在の Debian 環境では以下のコマンドでインストール可能です：

```bash
sudo apt install autoconf automake autotools-dev curl python3 libmpc-dev libmpfr-dev libgmp-dev gawk build-essential bison flex texinfo gperf libtool patchutils bc zlib1g-dev libexpat-dev ninja-build
```

clone 後、ツールチェーン内の `Installation (Newlib)` セクションに従えば基本的にインストールは成功しますが、ひとつ注意点があります：

> この方法でコンパイルした gcc は riscv-pk をコンパイルできず、`extension 'zifencei' required` というエラーが出ます。これはデフォルトのコンパイルオプションが zifencei 拡張（FENCE.I 命令）をサポートしていないためと推測されます。

使用可能なコンパイルオプションは以下の通りです：

```bash
./configure --prefix=/opt/riscv --with-arch=rv64gc
make
```

まず /opt 下に riscv フォルダを作成し、その所有者を通常ユーザーに設定することを推奨します。そうでない場合は chown が必要です：

```bash
sudo chown 1000:1000 /opt/riscv
```

ここでは uid と gid が共に 1000 と仮定していますが、具体的には `id` コマンドで確認できます。

インストール完了後は `/opt/riscv/bin` を PATH に追加する必要があります。具体的な方法は Google や ChatGPT で調べてください。以降のインストールもすべて `/opt/riscv` 配下に行います。完了後は `riscv64-unknown-elf-gcc` が使用可能なはずです。

### エミュレーター（spike）のインストール

リポジトリURL：https://github.com/riscv-software-src/riscv-isa-sim

clone した後、README の Build Steps セクションに従って直接インストールすれば問題ありません。現在のコマンドは以下の通りです：

```bash
$ sudo apt install device-tree-compiler
$ mkdir build
$ cd build
$ ../configure --prefix=/opt/riscv
$ make
$ make install
```

インストール完了後は `spike` コマンドが使えるようになります。

### シミュレーションカーネル（riscv-pk）のインストール

リポジトリURL：https://github.com/riscv-software-src/riscv-pk

pk（Proxy Kernel）は静的リンクされたユーザーモードの RISC-V プログラムを直接実行するためのもので、検証目的であればフルの OS を動かすより軽量です。

clone 後、README の Build Steps に従ってインストールします。落とし穴はツールチェーンの節で述べた FENCE.I 命令に関する問題のみです。現在のコマンドは以下の通りです：

```bash
$ mkdir build
$ cd build
$ ../configure --prefix=/opt/riscv --host=riscv64-unknown-elf
$ make
$ make install
```

### 動作確認

spike に付属のサンプルを使って検証します。hello.c を新規作成し、内容は以下の通りです：

```c
#include <stdio.h>

void main()
{
    const char *s = "Hello.\n";
    while (*s) putchar(*s++);
    while(1);
}
```

このファイルをコンパイルします：

```bash
$ riscv64-unknown-elf-gcc -o hello hello.c
```

spike で実行します：

```bash
spike pk hello
```

ターミナルに Hello. と表示され、ctrl+c を数回押すと終了します。