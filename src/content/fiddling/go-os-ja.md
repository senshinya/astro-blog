---
title: 失敗に終わったプロジェクト実践——春節七日間の楽しみ（起動せず）
tags: ["試行錯誤","golang", "os", "riscv"]
lang: ja
published: 2023-02-02T23:24:55+08:00
abbrlink: fiddling/go-os
description: "春節の連休中、ひらめきがひそかに訪れました。高速鉄道の中で偶然、裸機上でGoプログラムを動かす記事を読み、低レベルのシステムインターフェースへの探求心が刺激されました。著者の成功事例と実装は、高級言語とOSの融合の可能性に胸を躍らせます。関連研究を深めるうちに、このコンセプトは既に先例があることを知り、その熱意は徐々に積み重なり、期待に満ちたものの叶わなかったプロジェクト実践へと発展しました。"
---
### 発端

最初は春節に実家に帰る高速鉄道の中で、知乎でこの記事を見つけました：[Go プログラムを裸機上で動かす](https://zhuanlan.zhihu.com/p/265806072)。大まかなアイデアは、システムインターフェースを一から実装し、golang プログラムの各種システムコールや割り込みを制御するというものでした。このアイデアが非常に面白く感じられました。著者は golang で x86 用 OS を作り上げていて：[eggos](https://zhuanlan.zhihu.com/p/265806072)、完成度が非常に高いです。golang のランタイムを低レベルで改造しているため、ユーザープログラムは全く意識せずに動作し、様々な golang のサードパーティライブラリもそのまま使えます。さらに TCP/IP 対応のプロトコルスタックも実装し、一部のネットワークライブラリも直接利用可能にしています。見ていて胸が高鳴りました。

先人の研究を調べると、このアイデアはかなり以前から提案されていました。2018 年の OSDI 会議では、高級言語で OS を実装する利点と代償を論じた論文があり、スライドは [こちら](https://www.usenix.org/sites/default/files/conference/protected-files/osdi18_slides_cutler.pdf) にあります。また、関連実装も近年存在し、例えば [gopher-os](https://github.com/gopher-os/gopher-os) は golang で OS を実装可能であることを検証するためのカーネルです。さらに MIT の博士論文プロジェクト [Buscuit](https://github.com/mit-pdos/biscuit) はコンパイラをハックして裸機向けにコンパイル可能にし、POSIX インターフェースの一部を実装、redis や nginx も動作させています。

資料を調べる過程で共通点が見つかりました：すべて x86 アーキテクチャをベースにしていることです。私は以前 c 言語で RISC-V アーキテクチャの小さなカーネルを書いたことがあり、RISC-V のアセンブリや各種仕組みは非常にシンプルで書きやすいと感じていました。そこで思いついたのが、「go で RISC-V の OS を作ろう」というアイデアでした。

すぐに行動開始！実家に着いた翌日から取り掛かりました。

### とにかくやる！

プロジェクトを始めるにあたり、名前をつけることは重要です（冗談です）。

しかし、最初に思いついたのは絶妙な名前でした：goose

![README](https://blog-img.shinya.click/2025/736f6c389e54c1327775f1aa95dad597.png)

最高だぜ、みんな！

まず、go は RISC-V 64 ビット向けのクロスコンパイルをネイティブにサポートしているのはありがたいことです。`GOOS=linux GOARCH=riscv64`を go build コマンドの前に付けるだけで非常に簡単にビルドできます。

仮想マシンはいつものように qemu を使い、プラットフォームは virt です。virt プラットフォームのメモリ配置は、0x80000000 以上が物理メモリ領域、0x80000000 未満が mmio 領域（おおよそデバイスのメモリマップド領域で、この領域の操作はデバイス操作に相当）となっています。virt の起動時には pc が 0x80000000 にセットされます。

しかし、通常の go 実行ファイルはユーザーモードの仮想アドレス空間で動作するため、entry のアドレスは低いアドレス、だいたい 0x10000 付近です。幸いにも go はリンク時に TEXT セクションの開始アドレスを指定できる `-T`オプションを提供しており、これでコード全体を高アドレスに配置できます。また`-E`オプションでエントリーポイントを指定でき、go の起動処理を受け持つ関数を書くことが可能です（go プログラムのエントリは main 関数ではなく`_entry` 関数で、初期化処理を行います）。

しかし大きな問題がありました。エントリ関数は指定できても、その関数の開始アドレスを指定できず、0x80000000 に配置できません。virt の起動時に 0x80000000 には何があるかわからないコードがある可能性があります。通常 c 言語ならリンクスクリプトを書いて簡単に解決できますが、go の場合はそうはいきません。

調べてみると stackoverflow にこんな質問がありました：[go build でカスタムリンクスクリプトを使う方法](https://stackoverflow.com/questions/69111979/using-custom-linker-script-with-go-build)。go の組み込みリンカではなく外部リンカを使えばリンクスクリプトを指定できるとのこと。しかし試した結果、うまくいきませんでした。go の実行ファイルには text、bss、rodata、data 以外にも独自のセクションが多数あり、すべてリンクスクリプトで明示的に指定しなければならず、ほぼ不可能でした。

そこで方針転換。エントリは c 言語で書き、この c コードが go コードのエントリを動的に取得してジャンプする方法にしました。go コードのエントリは elf ファイル内にしか存在せず、ロード後のメモリイメージには情報がありません。そこで elf ファイルをバイナリとして c の data セクションにリンクし、メモリの開始と終了に名前を付けました。私は `_binary_kernel_elf_start`と`_binary_kernel_elf_end` を使いました。c コードはこのメモリ領域の elf ファイルを解析し、必要なセクションを物理メモリの対応するアドレスにコピーし、elf の指定する entry にジャンプします。

以下はエントリのアセンブリコードです。スタックをセットして c 関数にジャンプし、data セクション内のバイナリがコンパイル済み go 実行ファイルです：

```asm
    .section .text.entry
    .globl _start
    # sp をセットして main にジャンプするだけ
_start:
    la sp, bootstacktop
    call bootmain

# 起動スレッドのカーネルスタック bootstack は bss セクションの stack ラベルに配置
    .section .bss.stack
    .align 12
    .global bootstack
bootstack:
    # 16K バイトの領域を OS 起動スタックとして確保
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

c 関数 bootmain も非常にシンプルで、elf ファイルを解析しプログラムヘッダテーブルを読み、各セクションを物理メモリにロードします：

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

最後に entry は elf ヘッダから読み取った go のエントリ関数アドレスにジャンプします。

go のエントリ関数は rt0 で、アセンブリ関数です。go のアセンブリ形式は PLAN9 アセンブリで、古代の OS plan9 に由来します。この形式は複数の命令セットアーキテクチャをサポートしますが、公式ドキュメントはなく、x86 の例は多少ありますが RV64 は全く情報がなく、完全に手探りでした（

試行錯誤の末、エントリを書き上げました：

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

この形式もなかなかクセが強い……やっていることは、kernelStackTop を呼んで事前に割り当てたスタックトップアドレスを取得し、SP をそのアドレスにセット、その後 go のエントリ kmain を呼び出すだけです。go ファイルは非常にシンプル：

```go
type stack [16 * 4096]byte

type virtualAddress uintptr

var (
    kstack stack
)

//go:nosplit
func (s *stack) top() virtualAddress {
    stackTop := uintptr(unsafe.Pointer(&s[0])) + unsafe.Sizeof(*s)
    // 16 バイト境界にアライン
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

事前に stack 配列をカーネルスタックとして割り当て、kmain は何もせず無限ループ。各関数には `//go:nosplit` コンパイル指示があり、スタックオーバーフロー検査コードや GC チェックポイントの挿入を防ぎます。裸機では GC は全くサポートされず（もちろんカーネルで GC を動かすべきではなく、ユーザ空間のヒープ管理が主目的です）。

Makefile は以下のように書けます：

```make
Image: kernel.elf
    $(CC) $(CFLAGS) -fno-pic -O -nostdinc -I. -c boot/boot.c
    $(CC) $(CFLAGS) -fno-pic -nostdinc -I. -c boot/boot_header.S
    $(LD) $(LDFLAGS) -T image.ld -o Image boot.o boot_header.o

kernel.elf:
    GOOS=linux GOARCH=riscv64 go build -o kernel.elf -ldflags '-E goose/kernel.rt0 -T 0x80200000' -gcflags "-N -l" ./kmain
```

kernel.elf は go でビルドした elf ファイルで、エントリは goose/kernel.rt0、TEXT セクションの開始アドレスは 0x80200000 に指定。Image は先述のカーネルロード用エントリコードをビルドし、image.ld でエントリ関数を TEXT セクションの先頭に置き、TEXT セクションを 0x80000000 に配置しています。

```plain
/* 実行エントリポイント */
ENTRY(_start)

/* データ配置開始アドレス */
BASE_ADDRESS = 0x80000000;

SECTIONS
{
    /* . は現在のアドレス（ロケーションカウンタ） */
    . = BASE_ADDRESS;

    /* start シンボルは全体の開始位置 */
    kernel_start = .;

    text_start = .;

    /* .text セクション */
    .text : {
        /* エントリ関数を最初に配置 */
        *(.text.entry)
        /* リンク対象ファイルの.text セクションをまとめて配置 */
        *(.text .text.*)
    }
    ...
}
```

完璧！

興味が強かったため、春節の間ずっと親戚の家に行かず、部屋にこもって資料収集し、外でもぼんやり思考を巡らせ、まるで取り憑かれたかのようでした。

### 大失敗

ドンドンドン！

カーネルを qemu にロードして起動すると、プログラムセクションをメモリにロードするところで固まってしまいました。readelf で go ビルドの elf ファイルを調べると、こんな奇妙なものがありました。

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

注目すべきは 3 番目のセクションの Offset が 0xffffffffffff1000 という非常に大きな値であることです。Offset はファイル内のそのセクションの開始位置を示します。この elf ファイルは数十 KB しかないのに、そんな大きなオフセットがあるのはおかしい。仮にメモリにロードしても、virt マシンのデフォルト物理メモリは 128MB 程度であり、完全に破綻します。

原因がわからず試行錯誤した結果、`-T` リンクオプションを付けるとこの現象が起きることが判明。しかし付けないと低アドレスにロードされてしまい、mmio 領域と衝突します。そこで go の github リポジトリに issue を立てました：[cmd/link: riscv64 クロスコンパイル時に-T 指定でプログラムヘッダのオフセットが誤る](https://github.com/golang/go/issues/57983)。説明したところ、以下の回答がありました：

![ISSUE](https://blog-img.shinya.click/2025/42c633b821d4323697e542b47a8fce31.png)

どうやら RV64 での `-T` オプションのサポートが不十分なようです……

このためこのプロジェクトは現状凍結となりました。せっかく良い名前も思いついたのに/(ㄒo ㄒ)/。今後 go 公式がこの問題を修正してくれることを期待していますが、go は RV64 にあまり注力していない印象で、ネイティブクロスコンパイルのサポートもここ数年でようやくメインラインに入ったばかりです……

悔しさのあまり、Rust に乗り換えました！