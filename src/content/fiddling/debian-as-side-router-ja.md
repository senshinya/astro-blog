---
title: Debian バイパスルーター構成案
tags: ["試行錯誤","debian","バイパスルーター","VPN回避","透明プロキシ","mihomo"]
lang: ja
published: 2024-07-13T17:49:00+08:00
abbrlink: fiddling/debian-as-bypass-router
description: "Debian バイパスルーター構成案は、OpenWRTやLuCIへの依存を脱却し、より安定かつ柔軟な選択肢をユーザーに提供します。Debian上で直接設定を行うことで、システムの制御権を高め、GUIによる制限や不安定さを回避できます。一般的なバイパスルーター構成と比べて、Debian方式は透明プロキシの設定をより信頼性の高いものにし、性能と効率を追求するユーザーに新たな可能性をもたらします。"
---
### はじめに

多くのバイパスルーター構成は OpenWRT をベースにしています。OpenWRT は独自の Linux ディストリビューションで、独自のパッケージ管理システムを持っています。その中でも多くの構成は LuCI をベースにしており、LuCI は OpenWRT 専用の Web GUI で、チュートリアルで使われるソフトも luci-app-xxx のように LuCI 向けに作られています。これらの構成は良いものですが、完璧とは言えません：

1. GUI 設定への過度な依存：LuCI のパッケージは Web 上での設定が限定的です。
2. LuCI の安定性不足：OpenWRT 自体は安定していますが、LuCI が不安定なことがあります。私の LuCI は OpenClash の影響で 3 回クラッシュしたことがあります（私の設定ミスの可能性もありますが）。
3. OpenWRT を自分でビルドすることもできますが、多くのチュートリアルはプリビルドのファームウェアを使っており、古くなっている場合があります。
4. システム全体を完全に掌握できない（LuCI に制御されてしまう）。

私も以前、1〜2 年ほど OpenWRT の透明プロキシ構成や主ルーター・バイパスルーター構成を試みましたが、安定性に欠けるため最終的に断念しました。長い間は Surge、loon、clash verge rev などのクライアントを使ってなんとかしのいでいました。約 1 週間前、『絶区零』がリリースされましたが、国服版号の問題で PS5 は国際版のみのリリースとなりました。アジアサーバーを選んでも直結はかろうじて可能ですが、速度と遅延が絶望的です。NetEase UU にお金を払いたくないという思いから、再び透明プロキシを思い出しました。ちょうど手元に使っていないゼロ刻の小型 PC があり、Debian がプリインストールされていました。開発機として使うつもりでしたが、怠けて放置していました。そこで週末に試行錯誤し、最終的に Debian をバイパスルーターとして使い透明プロキシを構築することに成功しました。

最終的なネットワークトポロジーは以下の通りです：

![topo](https://blog-img.shinya.click/2025/c4347103c787f3d28b50a679e80aa0fe.png)

ご覧の通り、社内ネットワークは 2 つのセグメントに分割されています：192.168.6.0/24 と 192.168.7.0/24。6.0/24はデフォルトセグメントで、VPN不要の機器用、7.0/24はVPNが必要な機器用で、そのトラフィックはバイパスルーターである小型PCを経由します。

主な構成は AdguardHome + Clash で、AdguardHome は広告ブロックなどに使用し、Clash は DNS 分流とトラフィック代理を担当します。

### 主ルーター設定

設定前は社内 IP セグメントが 192.168.6.0/24 でしたが、新たに 192.168.7.0/24 を追加します。

私の主ルーターは iKuai です。以下は iKuai で新セグメントを追加する方法です。OpenWRT や他のルーターシステムの場合は各自 Google 検索してください。

iKuai のネットワーク設定 - 内外ネット設定 - lan1 の詳細設定で拡張 IP を追加し、IP を 192.168.7.1、サブネットマスクを 255.255.255.0 に設定します。

![iKuai 設定](https://blog-img.shinya.click/2025/9fc87b145274f1fb0cba1ed0d2329ac0.png)

DHCP 設定で 192.168.7.0/24 セグメントの DHCP 設定を追加します。

![DHCP 設定](https://blog-img.shinya.click/2025/2de91498b256d08c92a3c8844ca14dbe.png)

ゲートウェイは 192.168.7.2（後述のバイパスルーターのアドレス）、プライマリ DNS とセカンダリ DNS も 192.168.7.2 に設定します。このセグメント内の DNS は全てバイパスルーターが処理します。

### Debian 設定

以下の操作は特に記載がない限りバイパスルーター機器上で行います。

#### IP 設定

Debian のネットワーク設定を編集します。`sudo nano /etc/network/interfaces` を実行し、以下の内容に編集して保存してください。

```
# This file describes the network interfaces available on your system
# and how to activate them. For more information, see interfaces(5).

source /etc/network/interfaces.d/*

# The loopback network interface
auto lo
iface lo inet loopback

# The primary network interface
allow-hotplug enp1s0
iface enp1s0 inet static
address 192.168.7.2
netmask 255.255.255.0
gateway 192.168.7.1
dns-nameservers 127.0.0.1
```

この設定について：
- `enp1s0` は私のネットワークカード名です。ご自身の環境に合わせて`ip a`コマンドで確認し、適切な名前に変更してください。
- IPv4 ネットワークは静的設定（`inet static`）で、IP を `192.168.7.2/24`に固定し、ゲートウェイは主ルーターの`192.168.7.1`を指定しています。DNS は設定完了前は有効な DNS サーバーに設定し、AdguardHome 設定完了後に`127.0.0.1` に変更してください。設定途中でネット接続ができなくなるのを防ぐためです。

設定保存後、以下のコマンドでネットワークを再起動します。

```shell
sudo systemctl restart networking.service
```

この時点で SSH 接続が切断される可能性があります。新しい IP アドレス `192.168.7.2` で再度 SSH 接続してください。

`ip a`で設定結果を確認します。

```shell
ip a
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
    inet6 ::1/128 scope host noprefixroute
       valid_lft forever preferred_lft forever
2: enp1s0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
    link/ether 70:70:fc:00:e3:36 brd ff:ff:ff:ff:ff:ff
    inet 192.168.7.2/24 brd 192.168.7.255 scope global enp1s0
       valid_lft forever preferred_lft forever
    inet6 ■■■:■■■■:■■■■:■■■:■■■■:■■■■/64 scope global dynamic mngtmpaddr
       valid_lft 1741sec preferred_lft 1741sec
    inet6 fe80::7270:fcff:fe00:e336/64 scope link
       valid_lft forever preferred_lft forever
```

このようにローカル IP が 192.168.7.2/24 に変わっていることが確認できます。

#### 転送設定

トラフィック転送機能を持つ機器だけがルーターやゲートウェイとして機能します。

```shell
sudo echo "net.ipv4.ip_forward = 1" >> /etc/sysctl.conf
sudo sysctl -p
```

### AdguardHome 設定

以下に DNS の仕組みを説明します。

![DNS リンク](https://blog-img.shinya.click/2025/bb62d86943fdce26364eea909c4621a9.png)

クライアントが DNS を解決する際、ポート 53 で待ち受ける AdguardHome が上流の Clash に転送し、Clash は設定に従って分流します。中国本土向けは国内の公共 DNS サーバーで解決し、非中国本土向けはプロキシ経由で海外の公共 DNS サーバーに問い合わせます。

Clash に異常が発生した場合は、AdguardHome が直接国内公共 DNS に問い合わせます（実際には意味は薄いです。解決した IP もトラフィックは Clash 経由になるためです）。

#### AdguardHome インストール

root 権限で以下を実行します。

```shell
## 最新安定版のバージョン番号を確認。取得できない場合はネットワークを確認してください。
remote_ver=$(curl -sS https://api.github.com/repos/AdguardTeam/AdGuardHome/releases/latest | jq -r .tag_name | sed 's|v||' | grep -v "null"); echo $remote_ver

## 最新安定版をダウンロード（前のコマンドでバージョンが取得できた場合のみ実行）
cd /tmp
wget -q --progress=bar:dot --show-progress -O "AdGuardHome_linux_amd64.tar.gz" "https://github.com/AdguardTeam/AdGuardHome/releases/download/v${remote_ver}/AdGuardHome_linux_amd64.tar.gz"

## 解凍
tar --no-same-owner -xf "AdGuardHome_linux_amd64.tar.gz" --strip-components 2 --directory=.

## インストール
install -ps AdGuardHome /usr/local/bin/adguardhome
```

#### サービス作成

作業ディレクトリ `/var/lib/adguardhome` を作成します。

```shell
mkdir -p /var/lib/adguardhome
```

`/etc/systemd/system/adguardhome.service`を以下の内容で作成します。設定ファイルは `/var/lib/adguardhome/AdGuardHome.yaml` です。

```ini
[Unit]
Description = Network-wide ads & trackers blocking DNS server.
Wants       = network-online.target mosdns.service
After       = network-online.target mosdns.service

[Service]
Type               = simple
Restart            = always
StartLimitInterval = 5
StartLimitBurst    = 10
ExecStart          = /usr/local/bin/adguardhome -w /var/lib/adguardhome
RestartSec         = 10

[Install]
WantedBy = multi-user.target
```

保存後、`systemctl enable --now adguardhome.service`で自動起動設定と即時起動を行います。ログを確認したい場合は Debian 標準のツールを使います。

```shell
journalctl -efu adguardhome.service
```

再起動したい場合は以下を実行します。

```shell
systemctl restart adguardhome.service
```

#### 初期設定

ブラウザで `http://192.168.7.2:3000` にアクセスし初期設定を行います。ネットワーク管理画面のポートは 3000 のままで、DNS サーバーポートは 53 に設定してください。

設定 - DNS 設定で、上流 DNS にまだ設定していない Clash の DNS `127.0.0.1:1053` を指定し、バックアップ DNS に国内の DNS をいくつか入力します。

```
223.5.5.5
119.29.29.29
```

適用を忘れずにクリックしてください。

その後、DNS サービス設定 - 速度制限を 0 に設定します。

広告ブロックを行いたい場合はフィルター - DNS ブラックリストに以下の中国大陸で効果的なルールセットを追加することをおすすめします。

```
easylist:  https://anti-ad.net/easylist.txt
half-life: https://adguard.yojigen.tech/HalfLifeList.txt
```

### Clash 設定

Clash はこの構成で国内外の DNS 解決分流と VPN 回避を担当します。Clash の公式リポジトリは削除されてしまったため、mihomo が引き継いでいます（mihomo は mihoyo のことです）。

#### Clash インストール

root 権限で以下を実行します。

```shell
## 最新安定版のバージョン番号を確認。取得できない場合はネットワークを確認してください。
remote_ver=$(curl -sS https://api.github.com/repos/MetaCubeX/mihomo/releases/latest | jq -r .tag_name | sed 's|v||' | grep -v "null"); echo $remote_ver

## 最新安定版をダウンロード（前のコマンドでバージョンが取得できた場合のみ実行）
cd /tmp
wget -q --progress=bar:dot --show-progress -O "mihomo-linux-amd64-v${remote_ver}.gz" "https://github.com/MetaCubeX/mihomo/releases/download/v${remote_ver}/mihomo-linux-amd64-v${remote_ver}.gz"

## 解凍
gzip -d "mihomo-linux-amd64-v${remote_ver}.gz"

## インストール
install -ps mihomo-linux-amd64-v${remote_ver} /usr/local/bin/clash
```

#### サービス作成

作業ディレクトリ `/var/lib/clash` を作成します。

```shell
mkdir -p /var/lib/clash
```

ユーザー`clash` を作成します。

```shell
useradd -M -s /usr/sbin/nologin clash
```

`/etc/systemd/system/clash.service`を以下の内容で作成します。設定ファイルは `/var/lib/clash/config.yaml` です。

```ini
[Unit]
Description = Clash-Meta tproxy daemon.
Wants       = network-online.target
After       = network-online.target

[Service]
Environment   = PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/b>
Type          = simple
User          = clash
Group         = clash

CapabilityBoundingSet = CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW
AmbientCapabilities   = CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW

Restart       = always
ExecStartPre  = +/usr/bin/bash /var/lib/clash/clean.sh
ExecStart     = clash -d /var/lib/clash
ExecStartPost = +/usr/bin/bash /var/lib/clash/iptables.sh

ExecStopPost  = +/usr/bin/bash /var/lib/clash/clean.sh
```

このファイルからわかる通り、clash バイナリは `clash:clash` ユーザー権限で実行されます。これは clash 自身が発するトラフィックと、clash が転送するトラフィックを区別しやすくするためです。

`ExecStartPost`と `ExecStopPost`で`iptables.sh`と`clean.sh` を実行し、ルーティングテーブルの設定とクリアを行います。

iptables.sh と clean.sh の内容は以下の通りです。

```sh
#!/usr/bin/env bash

set -ex

# IPv4 転送を有効化
sysctl -w net.ipv4.ip_forward=1

# ルートルール設定
ip rule add fwmark 666 lookup 666
ip route add local 0.0.0.0/0 dev lo table 666

# clash チェーンを作成し、転送トラフィックを処理
iptables -t mangle -N clash

# ローカルネットワークや予約アドレスへのトラフィックは処理をスキップ
iptables -t mangle -A clash -d 0.0.0.0/8 -j RETURN
iptables -t mangle -A clash -d 127.0.0.0/8 -j RETURN
iptables -t mangle -A clash -d 10.0.0.0/8 -j RETURN
iptables -t mangle -A clash -d 172.16.0.0/12 -j RETURN
iptables -t mangle -A clash -d 192.168.0.0/16 -j RETURN
iptables -t mangle -A clash -d 169.254.0.0/16 -j RETURN

iptables -t mangle -A clash -d 224.0.0.0/4 -j RETURN
iptables -t mangle -A clash -d 240.0.0.0/4 -j RETURN

# その他の全トラフィックを 7893 ポートに転送し、マークを付与
iptables -t mangle -A clash -p tcp -j TPROXY --on-port 7893 --tproxy-mark 666
iptables -t mangle -A clash -p udp -j TPROXY --on-port 7893 --tproxy-mark 666

# 最後に PREROUTING で clash チェーンを通過させる
iptables -t mangle -A PREROUTING -j clash

# clash_local チェーンはゲートウェイ自身のトラフィックを処理
iptables -t mangle -N clash_local

# 内部ネットワークトラフィックをスキップ
iptables -t mangle -A clash_local -d 0.0.0.0/8 -j RETURN
iptables -t mangle -A clash_local -d 127.0.0.0/8 -j RETURN
iptables -t mangle -A clash_local -d 10.0.0.0/8 -j RETURN
iptables -t mangle -A clash_local -d 172.16.0.0/12 -j RETURN
iptables -t mangle -A clash_local -d 192.168.0.0/16 -j RETURN
iptables -t mangle -A clash_local -d 169.254.0.0/16 -j RETURN

iptables -t mangle -A clash_local -d 224.0.0.0/4 -j RETURN
iptables -t mangle -A clash_local -d 240.0.0.0/4 -j RETURN

# ゲートウェイ自身のトラフィックにマークを付与
iptables -t mangle -A clash_local -p tcp -j MARK --set-mark 666
iptables -t mangle -A clash_local -p udp -j MARK --set-mark 666

# clash プログラム自身のトラフィックはスキップ（clash は clash ユーザーで起動）
iptables -t mangle -A OUTPUT -p tcp -m owner --uid-owner clash -j RETURN
iptables -t mangle -A OUTPUT -p udp -m owner --uid-owner clash -j RETURN

# ゲートウェイ自身のトラフィックを clash_local にジャンプ
iptables -t mangle -A OUTPUT -j clash_local

# ICMP(ping) の修正
# ping 結果が有効になる保証はない（clash などは ICMP 転送非対応）が、応答は返るようにする
# --to-destination は到達可能なアドレスに設定
sysctl -w net.ipv4.conf.all.route_localnet=1
iptables -t nat -A PREROUTING -p icmp -d 198.18.0.0/16 -j DNAT --to-destination 127.0.0.1
```

```sh
#!/usr/bin/env bash

set -ex

ip rule del fwmark 666 table 666 || true
ip route del local 0.0.0.0/0 dev lo table 666 || true

iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X clash || true
iptables -t mangle -X clash_local || true
```

各行に詳細なコメントがあります。さらに詳しい内容は ChatGPT に質問してください。

#### Clash 設定ファイル

Clash の設定ファイルは各サブスクリプション提供者から入手可能で、yaml 形式です。`/var/lib/clash/config.yaml` に保存し、以下のようにモジュールを変更してください。

```yaml
tproxy-port: 7893   # iptables.sh で全トラフィックを 7893 ポートに転送
mixed-port: 7890
allow-lan: true
find-process-mode: off
bind-address: "*"
mode: rule
log-level: debug
ipv6: false # IPv6 トラフィックは代理しない

external-controller: 0.0.0.0:9090
secret: # UI ログインパスワード
external-ui: ui # webUI のベースパス
external-ui-name: xd # webUI のサブパス
external-ui-url: https://github.com/MetaCubeX/metacubexd/archive/refs/heads/gh-pages.zip
unified-delay: true
tcp-concurrent: true
experimental:
  sniff-tls-sni: true
geodata-mode: true
geodata-loader: standard
geox-url:
  geoip: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat
  geosite: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat
  mmdb: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/country.mmdb
profile:
  tracing: true
  store-selected: true
  store-fake-ip: true
sniffer:
  enable: true
  parse-pure-ip: true
  override-destination: true

dns:
  enable: true
  ipv6: false
  listen: 0.0.0.0:1053 # DNS 待ち受けポート
  use-hosts: true
  enhanced-mode: fake-ip
  default-nameserver: # 国内 DNS サーバーに変更推奨
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - https://doh.pub/dns-query
    - tls://dot.pub
    - tls://dns.alidns.com
    - https://dns.alidns.com/dns-query
  fallback:
    - https://dns.cloudflare.com/dns-query
    - tls://dns.google:853
    - https://1.1.1.1/dns-query
    - tls://1.1.1.1:853
    - tls://8.8.8.8:853
  fake-ip-filter:
    - '+.lan'
    - '+.cluster.local'
    - 'time.*.com'
    - 'time.*.gov'
    - 'time.*.edu.cn'
    - 'time.*.apple.com'
    - 'ntp.*.com'
    - 'localhost.ptlogin2.qq.com'
    - '+.ntp.org.cn'
    - '+.pool.ntp.org'
    - '+.localhost'
  fallback-filter:
    geoip: true
    geoip-code: CN
    geosite:
      - gfw
    ipcidr:
      - 224.0.0.0/4
      - 240.0.0.0/4
      - 169.254.0.0/16
      - 0.0.0.0/8
      - 127.0.0.1/32
    domain:
      - '+.google.com'
      - '+.facebook.com'
      - '+.youtube.com'

proxies:  # ここに代理ノード、グループ、ルールを記述
proxy-groups:
rules:
```

特に dns 部分について説明します。dns は 2 つの DNS サーバーグループに分かれています：

- nameserver は国内公共 DNS
- fallback は国外公共 DNS

fallback-filter はどの条件で fallback グループの DNS を使うか制御します。

- geoip-code は逆条件で、nameserver で解決した IP が geoip-code に該当しない場合に fallback を使います。
- geosite は正条件で、geosite にマッチするドメインは fallback を使います。
- ipcidr は正条件で、nameserver で解決した IP がこれらの範囲（汚染 IP）に該当した場合に fallback を使います。
- domain は正条件で、これらのドメインにマッチした場合に直接 fallback を使います。

これにより DNS 解決の分流が完成します。

#### Clash の関連ファイル

Clash は起動前に以下の補助ファイルをダウンロードする必要があります。

```shell
cd /var/lib/clash
wget -q --progress=bar:dot --show-progress -O country.mmdb https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb
wget -q --progress=bar:dot --show-progress -O geosite.dat  https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat
wget -q --progress=bar:dot --show-progress -O GeoIP.dat    https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat

mkdir -p ui
cd ui
wget -q --progress=bar:dot --show-progress -O xd.zip https://github.com/MetaCubeX/metacubexd/archive/refs/heads/gh-pages.zip
unzip -oqq xd.zip
mv metacubexd-gh-pages xd
```

最終的に `/var/lib/clash` ディレクトリは以下のようになります。

```shell
/var/lib/clash
├── clean.sh
├── config.yaml
├── country.mmdb
├── GeoIP.dat
├── geosite.dat
├── iptables.sh
└── ui
```

clash プログラムは clash ユーザーで起動するため、所有権を変更します。

```shell
chown -R clash:clash /var/lib/clash
```

また、iptables.sh と clean.sh に実行権限を付与します。

```shell
chmod +x iptables.sh
chmod +x clean.sh
```

#### サービス起動

全て設定完了後、`/etc/systemd/system/clash.service` を自動起動設定し、即時起動します。

```shell
systemctl enable --now clash.service
```

ログを確認したい場合は Debian 標準のツールを使います。

```shell
journalctl -efu clash.service
```

webUI は `http://192.168.7.2:9090/ui/xd` でアクセス可能です。

webUI の設定は皆さんよくご存知でしょう。設定が問題なければ、ローカルの DNS を 127.0.0.1 に変更し（前述）、社内機器のゲートウェイと DNS を 192.168.7.2 に設定してください。

### ポートフォワーディング

主ルーターでポートフォワーディングを設定し、かつ転送先機器のゲートウェイがバイパスルーターの場合、ポートフォワーディングが効かなくなります。この問題の解決策は [バイパスルーターのポートフォワーディング問題の解決](/ja/fiddling/fix-port-forward-in-bypass-router) の記事をご参照ください。