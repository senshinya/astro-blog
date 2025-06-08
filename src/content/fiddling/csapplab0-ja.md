---
title: CSAPP LAB 環境構築
tags: ["試行錯誤","CSAPP", "実験", "環境構築"]
lang: ja
published: 2021-12-27T00:09:00+08:00
abbrlink: fiddling/csapplab0
description: "CSAPPを学ぶ過程で、実験の重要性は無視できません。しかし、多くの学生がLinux環境の構築で様々なトラブルに遭遇し、特に仮想マシンを使う場合はインストールエラーや互換性問題、ネットワーク接続の不具合などが頻発し、挫折しがちです。これらの障害を解決するために、WSL（Windows Subsystem for Linux）は理想的な選択肢となります。特にWindows 10 バージョン2004以降のユーザーに適しており、仮想マシンの複雑さや性能のボトルネックを回避しつつ、よりシンプルで直接的にLinux環境を体験できます。"
---
### はじめに

> CSAPP を学びながら実験をしないのは、『四大名著』の中で『紅楼夢』を読まないようなものです。これはその人の教養や自己修養が不足していることを示しており、内在する高雅な芸術性を理解できず、表面的な言葉の羅列しか見えず、その深遠な精神的核心を読み解けません。そうした人はそこで成長が止まり、相対的に失敗した人生を送ることになります。

CSAPP の実験を挫折させる最大の要因は Linux 環境です。私も学部時代に一度 Vmware Workstation を使って Ubuntu Desktop をインストールして実験しました。個人的には大きな問題はありませんでしたが、周囲の人は以下のような問題に遭遇していました：

* 仮想マシンのインストールエラー
* Vmware と Hyper-V の互換性問題
* 仮想マシンのネットワーク接続不良
* 仮想マシンとホスト間の共有フォルダが機能しない
* Ubuntu の中国語入力環境
* その他の謎の問題

また、仮想マシンの性能も褒められたものではありません。ホストマシンからメモリを割り当てる必要があり、どちらが先に OOM（メモリ不足）になるか分からないという不安もあります。

以上の理由から、私は WSL（Windows Subsystem for Linux、Windows 向け Linux サブシステム）を選びました。推奨 OS は Windows 10 Version 2004 以降、または Windows 11 で、WSL 2 を利用できます。これより古い Windows では WSL 機能があっても WSL 1 であり、Linux のシステムコールを Windows のシステムコールに翻訳するレイヤーを使っています。一方、WSL 2 は軽量でメンテナンス不要の仮想マシンを使用し、その中で完全な Linux カーネルを動作させています。CSAPP の実験には完全な Linux カーネルが不可欠です。

「MacOS はどうするの？」と聞かれたら、Intel チップ搭載の MacBook なら VirtualBox、VMware Fusion、Parallel Desktop をインストールして Linux ディストリビューションを入れるか、Docker を使うのが良いでしょう。M1 チップの MacBook については、**パソコンを買い替えることを強くおすすめします**（冗談ではなく、M1 は実験には本当に向きません）。

ああ、話が長くなってしまいました。

### WSL と Ubuntu のインストール

Windows で WSL をインストールするのは非常に簡単で、管理者権限のある PowerShell で以下のコマンドを入力するだけです：

```shell
wsl --install -d Ubuntu
```

システムが必要な機能を自動的に設定し、Ubuntu の最新 LTS（この記事執筆時点では 20.04）を自動でダウンロードします。インストール完了後、端末が起動し、ユーザー名とパスワードの入力を求められます：

```shell
Installing, this may take a few minutes...
Please create a default UNIX user account. The username does not need to match your Windows username.
For more information visit: https://aka.ms/wslusers
Enter new UNIX username: shinya
New password:
Retype new password:
passwd: password updated successfully
Installation successful!
```

パスワード入力時は画面に表示されませんのでご注意ください。

設定が完了すると、`shinya@DESKTOP-4TMFLAE:~$` のようなプロンプトが表示され、コマンド入力を待ちます。これで Ubuntu システムに入ったことになります。

### いくつかの便利な使い方

#### Windows Terminal

Windows Terminal は、Windows 上で最も優れた端末と言えます。

Windows Terminal は Microsoft Store で「Windows Terminal」を検索してインストールするか、GitHub のリリースページ（[https://github.com/microsoft/terminal/releases](https://github.com/microsoft/terminal/releases)）から msixbundle ファイルをダウンロードしてダブルクリックでインストールできます。

WSL と Ubuntu をインストール済みなら、Windows Terminal のタブの「＋」ボタンのドロップダウンに Ubuntu の項目が表示されます。クリックすれば Ubuntu のデフォルトシェルがすぐに開きます。

#### ファイル共有

WSL の Ubuntu と Windows は別々の隔離されたシステムで、それぞれ独自のファイルシステムを使っています。しかし、完全に隔離されているわけではありません。

Windows の C ドライブは Ubuntu 内で `/mnt/c` にマウントされています。例えば Linux から Windows のデスクトップにアクセスするには：

```shell
$ cd /mnt/c/Users/Shinya/Desktop
$ ls
 course.py     desktop.ini     szxx.bat     szxx.txt
```

逆に、Windows で WSL のファイルシステム（例：`~`）を見たい場合は、Ubuntu 内で以下のコマンドを使います。例えばユーザーフォルダを開くには：

```shell
$ cd ~
$ explorer.exe .
```

すると Windows のエクスプローラーが開き、対象フォルダの内容が表示されます。Windows のフォルダと同じように操作可能です。

#### Visual Studio Code

VSCode は世界最高のテキストエディタで、WSL 内のフォルダを直接開け、ローカルプロジェクトと同様の体験を提供します。もちろん、vim で実験するのが好きな人もいますが。

まず Windows 版の VSCode を開き、拡張機能ストアで「WSL」を検索し、「Remote - WSL」をインストールします。通常、このキーワードの最初の結果です。

次に Ubuntu 内のプロジェクトフォルダで以下を実行します：

```shell
$ code .
```

初回実行時は関連コンポーネントがインストールされます：

```shell
$ code .
Installing VS Code Server for x64 (899d46d82c4c95423fb7e10e68eba52050e30ba3)
Downloading: 100%
Unpacking: 100%
```

その後、自動的に Windows 版 VSCode が起動し、Ubuntu のプロジェクトフォルダが作業ディレクトリとして開かれます。あとは自由に開発できます。

#### 中国のミラーサーバーに切り替える

まず「ミラーサーバー（源）」とは何かを説明します：

> 古い文献によると、天地が合わさり万物が生まれた時代、混沌とした霧が立ち込め、多くの霊物が天地の本源の精気を吸収し、琥珀のような結晶を結び、その中に巨大な生命の精華を封じ込めた。  
> 現代まで保存されたものが「源」と呼ばれる。

すみません、脱線しました。

簡単に言うと、Ubuntu や Debian 系のパッケージ管理ツール apt は、ソフトウェアをインストールする際に URL リスト（ミラーサーバー）から検索・ダウンロードします。この URL リストが「源」です。デフォルトは海外のサーバーであり、よく知られている理由で速度が遅かったり接続できなかったりします。そこで国内のミラーサーバーに切り替えます。

手順は以下の通り：

```shell
$ sudo mv /etc/apt/sources.list /etc/apt/sources.list.bak
$ sudo nano /etc/apt/sources.list
```

以下の内容を貼り付けます。ここでは阿里云（Alibaba Cloud）のミラーを使っています。ディストリビューションやバージョンによってミラーは異なるので注意してください。これは Ubuntu 20.04 用です。

```shell
deb http://mirrors.aliyun.com/ubuntu/ focal main restricted universe multiverse
deb-src http://mirrors.aliyun.com/ubuntu/ focal main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ focal-security main restricted universe multiverse
deb-src http://mirrors.aliyun.com/ubuntu/ focal-security main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ focal-updates main restricted universe multiverse
deb-src http://mirrors.aliyun.com/ubuntu/ focal-updates main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ focal-proposed main restricted universe multiverse
deb-src http://mirrors.aliyun.com/ubuntu/ focal-proposed main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ focal-backports main restricted universe multiverse
deb-src http://mirrors.aliyun.com/ubuntu/ focal-backports main restricted universe multiverse
```

その後、ミラー情報を更新しパッケージをアップグレードします：

```shell
$ sudo apt update
$ sudo apt upgrade
```

### 実験に必要なソフトウェアのインストール

#### パッケージ

必要最低限は以下の一行です：

```shell
$ sudo apt install build-essential gcc-multilib gdb
```

オプションで cgdb もおすすめです。cgdb は GDB の軽量フロントエンドで、gdb コマンド画面とソースコードを分割表示します。apt のリポジトリの cgdb は最新でないため、ソースからビルドします。手順は以下：

```shell
$ sudo apt install automake libncurses5-dev flex texinfo libreadline-dev
$ git clone git://github.com/cgdb/cgdb.git
$ cd cgdb
$ ./autogen.sh
$ ./configure --prefix=/usr/local
$ make
$ sudo make install
```

インストール後はどこでも `cgdb` コマンドで起動可能です。例えば：

![CGDB](https://blog-img.shinya.click/2025/a36f15210399888f0e0cf56efe45a202.jpg)

CGDB

左側がコードウィンドウ、右側が gdb ウィンドウです。

起動時は上下分割ですが、`ctrl+w` で左右分割に切り替えられます。

`esc` キーでフォーカスを gdb ウィンドウからコードウィンドウに移し、コードウィンドウで上下にソースを閲覧、スペースキーで現在行にブレークポイントを設定できます。

`i` キーでフォーカスをコードウィンドウから gdb ウィンドウに戻し、gdb の操作は通常通りです。

詳しい使い方は [CGDB 中文マニュアル](https://leeyiw.gitbooks.io/cgdb-manual-in-chinese) をご覧ください。

#### 実験はどこで？

CSAPP を独学しているなら、このサイトがおすすめです：[http://csapp.cs.cmu.edu/3e/labs.html](http://csapp.cs.cmu.edu/3e/labs.html)  
各実験の後にある Self-Study Handout のリンクが実験資料のダウンロード先です。WSL に入れて、楽しく実験しましょう！