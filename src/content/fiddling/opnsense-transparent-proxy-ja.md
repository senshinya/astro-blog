---
title: OPNsenseでの透明プロキシ＋分流の実現
tags: ["試行錯誤","VPN突破","透明プロキシ","OPNsense","分流"]
lang: ja
published: 2025-01-16T23:09:00+08:00
abbrlink: fiddling/opnsense-transparent-proxy
description: "OPNsenseはオープンソースのファイアウォール兼ルーティングシステムで、美しいユーザーインターフェースと充実した機能により注目を集めています。様々なルーティング構成を経て、透明プロキシとトラフィックの分流における強力な可能性が徐々に認識されました。BGPによる分流転送方式を組み合わせることで、OPNsenseはより高い安全性と安定性を提供し、理想的なネットワーク管理ソリューションとなっています。特にIPリストの自動更新機能により、ネットワーク管理が一層便利になっています。"
---
### はじめに

これまで透明プロキシ＋分流は主にikuaiをメインルーター、OpenWRTをサブルーターとする構成で運用していました。これはネット上の多くのチュートリアルで主流の方法です。しかし、調査を進めるうちにikuaiには[トラフィックの無断送信や情報報告の問題](https://wusiyu.me/2022-ikuai-non-cloud-background-activities/)がある可能性が判明し、また国産のクローズドソースシステムであるためセキュリティ面でも懸念がありました。

その後、メインルーターをOpenWRTに変更し、サブルーターにDebianを用いた[構成](/ja/fiddling/debian-as-bypass-router)に切り替えました。さらにサブルーターを使わない構成にし、[FakeIPベースの分流転送](/ja/fiddling/fake-ip-based-transparent-proxy)や[より正確なBGPベースの分流転送](/ja/fiddling/more-accurate-chnroute)を試行し、最終的にBGPベースの分流転送に安定しました。

最近、OPNsenseというファイアウォール兼ルーティングシステムを知りました。まさに理想のルーターシステムで、オープンソースかつ無料、UIが美しく機能も充実しています。さらにGUIでIPリストの自動更新をサポートし、分流に活用できます。そこで、現在の分流転送構成をこのシステムに移行し、別途ソフトルーターを用いずにclashをメインルーターに統合する計画を立てました。

ネット上の関連チュートリアルは少なく、一部は古くて使えなくなっているものもあります。いくつかの落とし穴を経験したので、詳細な構成を整理しておきます。

実現したい機能は以下の通りです：
- DNSをclashに転送し一元的に解決
- リクエストトラフィックがOPNsenseに入った後、特定のリストに基づいて分流し、一部トラフィックをclashに導入

OPNsenseの基本的なインストール手順は割愛します。ネット上に多くの情報があります。

### clashのインストール

#### バイナリのダウンロードと設定ファイル

DNS解決とトラフィック処理はclashに依存するため、まずclashをインストールします。

OPNsenseにSSHでログイン（SSHの有効化方法はSTFW）し、`/usr/local/clash`フォルダを作成します。ここにclashのバイナリ、設定ファイル、その他関連ファイルを置きます。clashのバイナリはscpで転送することを推奨します（メインルーターはまだVPN未設定のため、直接ダウンロードは遅いです）。clashのバイナリは`clash`にリネームし、設定ファイルは`config.yaml`とします。

mihomoの[リリースページ](https://github.com/MetaCubeX/mihomo/releases)から最新のカーネル版をダウンロードしてください。FreeBSD版を選び、マシンのアーキテクチャに応じて386、amd64、arm64を選択します。amd64でclash実行時に以下のエラーが出る場合は、`amd64-compatible`版をダウンロードしてください。

```shell
This PROGRAM can only be run on _AMD64 processors with v3 microarchitecture_ support.
```

設定ファイルは普段使っているものを流用して構いませんが、以下の設定は必ず変更してください。

```yaml
mixed-port: 7890

dns:
  listen: 127.0.0.1:5353

tun:
  enable: false
```

DNSは5353ポートで待ち受け、OPNsenseの内蔵DNSの上流として機能します。tunは無効にし、トラフィックの強制的な横取りはせず、OPNsense側でトラフィックを選別して導入します。mixed-portはsocks-port、http-port、https-portの役割を兼ねています。

`pw user add clash -c "Clash" -s /usr/sbin/nologin`でログイン不可のclashユーザーを作成し、`chown clash:clash /usr/local/clash`でフォルダの権限を付与します。完了後、`/usr/local/clash/clash -d /usr/local/clash`で一度実行し、正常に動作するか確認してください。

#### clashサービスの登録

`/usr/local/etc/rc.d/clash`と`/usr/local/opnsense/service/conf/actions.d/actions_clash.conf`を新規作成し、clashをシステムサービスとして登録します。

```shell
#!/bin/sh
# $FreeBSD$

# PROVIDE: clash
# REQUIRE: LOGIN cleanvar
# KEYWORD: shutdown

# Add the following lines to /etc/rc.conf to enable clash:
# clash_enable (bool): Set to "NO" by default.
# Set to "YES" to enable clash.
# clash_config (path): Clash config dir.
# Defaults to "/usr/local/etc/clash"

. /etc/rc.subr

name="clash"
rcvar=clash_enable

load_rc_config $name

: ${clash_enable:="NO"}
: ${clash_config="/usr/local/clash"}

command="/usr/local/clash/clash"
#pidfile="/var/run/clash.pid"
required_files="${clash_config}"
clash_group="clash"
clash_user="clash"

command_args="-d $clash_config"

run_rc_command "$1"
```

```
[start]
command:/usr/local/etc/rc.d/clash onestart
type:script
message:starting clash

[stop]
command:/usr/local/etc/rc.d/clash stop
type:script
message:stoping clash

[status]
command:/usr/local/etc/rc.d/clash statusexit 0
type:script_output
message:get clash status

[restart]
command:/usr/local/etc/rc.d/clash onerestart
type:script
message:restarting clash
```

実行権限を付与し（`chmod +x /usr/local/etc/rc.d/clash`）、`service configd restart`で有効化します。

#### clashの自動起動設定

clashをシステムサービスとして起動すると、起動後にバックグラウンドに回らずフォアグラウンドに留まるため、再起動時にclash起動後のサービスが進まなくなる問題があります。

これを回避するため、OPNsense標準のサービス監視機能Monitを使い、clashの状態を監視・再起動させる方法があります。Monitは「サービス - Monit」から有効化可能です。

Service Test Settingsに以下の2つのService Testを追加します。1つ目はclashの起動監視用です。

| 設定項目 | 値                                         |
| -------- | ------------------------------------------ |
| Name     | Clash                                      |
| Condition| failed host 127.0.0.1 port 7890 type tcp   |
| Action   | Restart                                    |

2つ目は再起動の無限ループ防止用です。

| 設定項目 | 値                         |
| -------- | -------------------------- |
| Name     | RestartLimit4              |
| Condition| 5 restarts within 5 cycles |
| Action   | Unmonitor                  |

最後にService Settingsで以下を追加します。

| 設定項目 | 値                                         |
| -------- | ------------------------------------------ |
| Name     | Clash                                      |
| Match    | clash                                      |
| Start    | /usr/local/sbin/configctl clash start      |
| Stop     | /usr/local/sbin/configctl clash stop       |
| Tests    | Clash,RestartLimit4                         |

保存後、しばらく待ってMonit - Statusでclashが正常に動作しているか確認してください。

### DNS解決

OPNsense標準のUnbound DNSで上流DNSをclashの127.0.0.1:5353に設定すると、解決エラーが頻発し非常に不安定でした。

原因が分からず、最終的にUnbound DNSを無効化し、AdGuard HomeをデフォルトDNSとして利用し、53番ポートを強制的に奪う形にしました。

AdGuard HomeはOPNsenseの標準プラグインリポジトリに含まれていないため、コミュニティリポジトリを手動で追加する必要があります。

OPNsenseにSSHでログインし、以下を実行します。

```shell
$ fetch -o /usr/local/etc/pkg/repos/mimugmail.conf https://www.routerperformance.net/mimugmail.conf
$ pkg update
```

その後、Web GUIの「システム - ファームウェア - プラグイン」で「adguard」を検索し、`os-adguardhome-maxit`をインストールします。インストール完了後、「サービス - Adguardhome」でAdGuard Homeを起動可能です。Web管理画面は3000番ポートで開放されます。初期設定は省略しますが、DNSのリッスンポートは53に設定し、OPNsenseマシンのデフォルトDNSサーバーとして機能させます。

インストール後、AdGuard Homeの設定 - DNS設定で上流DNSサーバーを127.0.0.1:5353（clashのDNSリッスンアドレス）に設定してください。

### 国内外IPの分流

#### バイナリのダウンロードと設定ファイル

OPNsenseには標準でSquidプロキシが組み込まれていますが、これはHTTP/HTTPSトラフィックのみを代理し、通常のTCP/UDPトラフィックは代理できません。そのため、tun2socksプロジェクトを利用し、TCP/UDPトラフィックをclashに導入する迂回策を採用します。

`/usr/local/tun2socks`フォルダを作成し、[Github Releases](https://github.com/xjasonlyu/tun2socks/releases)から最新のFreeBSDバイナリをダウンロードしてフォルダに置き、`tun2socks`にリネームします。設定ファイル`/usr/local/tun2socks/config.yaml`を新規作成します。

```yaml
# debug / info / warning / error / silent
loglevel: info

# URL format: [protocol://]host[:port]
proxy: socks5://127.0.0.1:7890

# URL format: [driver://]name
# TUNデバイス名。tun0は避ける
device: tun://proxytun2socks0

# パケット毎の最大転送単位
mtu: 1500

# UDPセッションのタイムアウト（デフォルト60秒）
udp-timeout: 120s
```

`proxy`にはclashのsocks5ポートのアドレスを記入します。

`/usr/local/tun2socks/`内で`./tun2socks -config ./config.yaml`を実行し、設定が正しいかテスト可能です。

#### サービスの登録

`/usr/local/etc/rc.d/tun2socks`と`/usr/local/opnsense/service/conf/actions.d/actions_tun2socks.conf`を新規作成します。

```shell
#!/bin/sh

# PROVIDE: tun2socks
# REQUIRE: LOGIN
# KEYWORD: shutdown

. /etc/rc.subr

name="tun2socks"
rcvar="tun2socks_enable"

load_rc_config $name

: ${tun2socks_enable:=no}
: ${tun2socks_config:="/usr/local/tun2socks/config.yaml"}

pidfile="/var/run/${name}.pid"
command="/usr/local/tun2socks/tun2socks"
command_args="-config ${tun2socks_config} > /dev/null 2>&1 & echo \$! > ${pidfile}"

start_cmd="${name}_start"

tun2socks_start()
{
    if [ ! -f ${tun2socks_config} ]; then
        echo "${tun2socks_config} not found."
        exit 1
    fi
    echo "Starting ${name}."
    /bin/sh -c "${command} ${command_args}"
}

run_rc_command "$1"
```

```
[start]
command:/usr/local/etc/rc.d/tun2socks start
parameters:
type:script
message:starting tun2socks

[stop]
command:/usr/local/etc/rc.d/tun2socks stop
parameters:
type:script
message:stopping tun2socks

[restart]
command:/usr/local/etc/rc.d/tun2socks restart
parameters:
type:script
message:restarting tun2socks

[status]
command:/usr/local/etc/rc.d/tun2socks status; exit 0
parameters:
type:script_output
message:request tun2socks status
```

`/etc/rc.conf`を作成し、以下を追加します。

```
tun2socks_enable="YES"
```

実行権限を付与（`chmod +x /usr/local/etc/rc.d/tun2socks`）し、`service configd restart`で有効化します。

手動でtun2socksを起動します。

```shell
/usr/local/etc/rc.d/tun2socks start
```

#### 起動時自動起動設定

`/usr/local/etc/rc.syshook.d/early/60-tun2socks`を作成します。

```bash
#!/bin/sh

# tun2socksサービスを起動
/usr/local/etc/rc.d/tun2socks start
```

実行権限を付与（`chmod +x /usr/local/etc/rc.syshook.d/early/60-tun2socks`）します。

#### 新規ポート作成とゲートウェイ設定

OPNsenseの「インターフェース - 割り当て」で新規インターフェースを追加し、デバイスに設定ファイルで指定した`proxytun2socks0`を選択して保存します。

追加したインターフェースの設定画面でインターフェースを有効化し、説明欄に「TUN2SOCKS」と記入、IPv4設定タイプは「静的IPv4」を選択、IPv4アドレスは`10.0.3.1/24`に設定して保存します。

「システム - ゲートウェイ - 設定」で新規ゲートウェイを作成し、名前を「TUN2SOCKS_MIHOMO」、インターフェースに先ほど追加した「TUN2SOCKS」を選択、IPアドレスは`10.0.3.2`に設定し、他はデフォルトのまま保存します。

これで新しいゲートウェイが作成され、このゲートウェイに流れるトラフィックは127.0.0.1:7890、つまりclashに転送されます。

#### 国内外IPの分流設定

OPNsenseで最も便利な機能の一つが「ファイアウォール - エイリアス」です。ここでIPリストを設定し、後のルール設定で直接利用できます。このリストは手動入力だけでなく、URLから動的に取得することも可能です。

「ファイアウォール - エイリアス」で2つのエイリアスを新規作成します。

1つ目は「InternalAddress」で、LAN内のアドレス範囲を示します。タイプは「Network(s)」を選択し、内容は以下の通りです。

```
0.0.0.0/8
127.0.0.0/8
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.0.0/16
224.0.0.0/4
240.0.0.0/4
```

2つ目は「CN_V4」で、国内IPアドレス範囲を示します。タイプは「URL Table (IPs)」を選択し、内容には国内の全網域を含むリストのURLを入力します。例として以下を使えます。

```
https://raw.githubusercontent.com/gaoyifan/china-operator-ip/refs/heads/ip-lists/china.txt
```

次に「ファイアウォール - ルール - LAN」で2つのルールを新規作成し、ルールリストの最上位に配置します。ルールは上から順に評価されるため順序に注意してください。

1つ目のルールはターゲットを「InternalAddress」に設定し、その他はデフォルトのままです。これはターゲットがLAN内アドレスの場合、デフォルトルールでルーティングすることを意味します。

2つ目のルールはターゲットを「CN_V4」に設定し、「ターゲット/反転」にチェックを入れます。ゲートウェイは先ほど作成した「TUN2SOCKS_MIHOMO」を選択します。これはターゲットが中国IP以外の場合にトラフィックをTUN2SOCKS_MIHOMOゲートウェイに転送することを意味します。

残りのルールはデフォルトのままで、その他すべてのトラフィックは従来通り国内IPは直通となります。

Googleなどにアクセスを試みると、DNSリクエストはAdGuard Homeを経由してclashに転送され、Googleの実IPが解決されます。その後、そのIPへのデータ要求はファイアウォールの2つ目のルールにマッチし、TUN2SOCKS_MIHOMOゲートウェイに転送され、socks5ポート経由でclashに入り、最終的にVPN突破が実現されます。