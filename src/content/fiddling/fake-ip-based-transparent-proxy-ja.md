---
title: FakeIPを用いた透明プロキシの分流方法
tags: ["試行錯誤","VPN","透明プロキシ","FakeIP"]
lang: ja
published: 2024-08-16T23:53:00+08:00
abbrlink: fiddling/fake-ip-based-transparent-proxy
description: "FakeIPを活用した透明プロキシの分流ソリューションは、従来のバイパスルーターにおける単一障害点、性能不足、複雑なポートマッピング問題を解決することを目的としています。新たなプロキシコアであるsing-boxを導入することで、転送性能の向上と設定の簡素化を実現しました。sing-boxはより多彩なプロトコルをサポートし、clashよりも明らかに最適化効果が優れており、高効率な透明プロキシの実現に最適な選択肢となっています。clashでも同様の実装は可能ですが、sing-boxの導入によりユーザーはより柔軟な体験を享受できます。"
---
### はじめに

[前回の記事](/ja/fiddling/debian-as-bypass-router) では、バイパスルーターを用いた LAN 内透明プロキシの構築方法を紹介しました。多くのユーザーにとっては十分に実用的ですが、以下のような課題も明確に存在します。

1. DHCP で配布されるゲートウェイが直接バイパスルーターを指すため、バイパスルーター上の clash が利用不可になると、科学的なサイトを利用しなくてもインターネットに接続できなくなる単一障害点のリスクがある。
2. clash のパケット転送性能は弱く、ハードウェア転送には遠く及ばない。ゲートウェイをバイパスルーターに設定すると、iptables の設定により科学的なトラフィックの有無にかかわらず全トラフィックが clash 経由になる。
3. バイパスルーターがゲートウェイであるため、ポートマッピングをメインルーターとバイパスルーターの両方で設定する必要がある。

ちょうど最近、sing-box という新しいプロキシコアを見かけました（clash archive 終了後に注目され始めたため、完全に新しいわけではありません）。[Wiki](https://sing-box.sagernet.org/configuration) を確認すると、対応プロトコルや機能が非常に充実しており、性能面でも clash より優れていることがわかりました。そこで新しい方案ではプロキシコアに sing-box を採用します。

もちろん、この方案は clash でも実現可能です（

~~残念ながら sing-box の Wiki は VPN 越えが必要です~~

### 方案の考え方

sing-box も clash も DNS モジュールを内蔵しており、DNS サーバー機能を持ち、FakeIP をサポートしています。FakeIP とは、<mark>クライアントが DNS クエリを行うと、DNS モジュールが即座に偽の IP アドレスを返し、裏で実際の DNS クエリを行い、この偽 IP と実 IP のマッピングを管理します。クライアントがこの FakeIP を使って接続を試みると、ゲートウェイはマッピング情報を参照して実際の IP へリクエストを転送します。</mark>より詳しい説明は [RFC3089](https://datatracker.ietf.org/doc/html/rfc3089) をご覧ください。後続のトラフィックルーティングで FakeIP と実 IP の対応が必要なため、単なる DNS サーバーだけでは FakeIP 機能を実現できません。

FakeIP は通常予約済みネットワーク（多くは `198.18.0.0/15`）に属し、分流の特徴が非常に明確で、分流も簡単です。ソフトルーターの DNS モジュールは代理が必要なドメインにのみ FakeIP を返し、メインルーターで次ホップを設定して FakeIP 宛のトラフィックだけをソフトルーターに通し、FakeIP 以外のトラフィックは通常通り転送します。具体的には以下の通りです。

 ![fakeIP 分流](https://blog-img.shinya.click/2025/e078ffe1fe41b2cbcb04b40a55cbbc56.png)

```
1. 代理不要なドメインの場合
  1. クライアントが DNS 解決を行う
  2. DNS モジュールが代理不要と判断し、国内 DNS に問い合わせて RealIP を返す
  3. クライアントは RealIP で接続を開始
  4. メインルーターは FakeIP でないことを判定し、デフォルトルート（直結）で転送

2. 代理が必要なドメインの場合
  1. クライアントが DNS 解決を行う
  2. DNS モジュールが代理必要と判断し、FakeIP を返し、国外 DNS に問い合わせ
  3. クライアントは FakeIP で接続を開始
  4. メインルーターは FakeIP と判定し、トラフィックを代理ソフトへルーティング
  5. 代理ソフトは FakeIP マッピングを参照し、出口ノードを経由して国外 IP へリクエストを送信
```

この方案は前回の記事で挙げた 3 つの課題を解決します。

1. 単一障害点問題：sing-box の DNS 解析は AdGuard の後段に配置されており、sing-box が停止しても AdGuard が上流 DNS 異常を検知し、バックアップ DNS（国内 DNS）へ切り替えます。FakeIP を返さないため、全トラフィックはメインルーターでデフォルトルートを通ります。
2. 代理不要トラフィックは代理ソフトを経由せず、直接ルーティングされるため、性能向上。
3. 転送はメインルーターのルーティングテーブルで行い、全クライアントのゲートウェイはメインルーターなので二重 NAT は発生せず、ポートマッピングもメインルーターのみで完結。

### 実装詳細

#### メインルーター設定

まずメインルーターで次ホップゲートウェイを設定します。ikuai の場合、「流量制御分流」→「分流設定」→「ポート分流」で分流ルールを追加し、分流方式を「次ホップゲートウェイ」に設定、ソフトルーターの IP（例：192.168.7.2）を入力します。宛先アドレスに `198.18.0.0/15` を追加し、他はデフォルトのままで OK です。

 ![次ホップゲートウェイ](https://blog-img.shinya.click/2025/37f3bc2ebbd0f4f79e218c2a949a84c4.png)

これで宛先が `198.18.0.0/15` のトラフィックはメインルーター通過時に 192.168.7.2 へ転送されます。

#### sing-box のインストールと設定

[前回の記事](/ja/fiddling/debian-as-bypass-router) の手順で AdGuard Home を構築し、上流 DNS は引き続き 127.0.0.1:1053 に設定します。次に sing-box をインストールします。Debian なら以下のコマンド一発です。

```shell
bash <(curl -fsSL https://sing-box.app/deb-install.sh)
```

他のディストリビューションのインストール方法は [公式サイト](https://sing-box.sagernet.org/installation/package-manager/#__tabbed_2_1) を参照してください。

インストール後、systemd サービスが自動作成されます。sing-box の systemd サービスは少し特殊で、定義ファイルは `/lib/systemd/system/sing-box.service` にあります。このファイルを編集し、`ExecStart` の前に以下 3 行を追加します。

```shell
ExecStartPre  = +/usr/bin/bash /etc/sing-box/clean.sh
ExecStartPost = +/usr/bin/bash /etc/sing-box/iptables.sh
ExecStopPost  = +/usr/bin/bash /etc/sing-box/clean.sh
```

これは前回の方案と同様に、起動時にルーティング設定を行い、停止時にクリーンアップするためです。sing-box の全設定は `/etc/sing-box` にあり、デフォルト設定ファイルは `/etc/sing-box/config.json` なので、ここも統一します。

`/etc/sing-box/iptables.sh` と `/etc/sing-box/clean.sh` を以下のように作成します。

```shell
#!/usr/bin/env bash

set -ex

# IPv4 転送を有効化
sysctl -w net.ipv4.ip_forward=1
# IPv6 転送を有効化
sysctl -w net.ipv6.conf.all.forwarding=1

### IPv4 ルーティングルール ###
# ルートルール追加
ip rule add fwmark 666 lookup 666
ip route add local 0.0.0.0/0 dev lo table 666

# clash チェーンは転送トラフィックを処理
iptables -t mangle -N clash

# プライベートネットワークはスキップ
iptables -t mangle -A clash -d 0.0.0.0/8 -j RETURN
iptables -t mangle -A clash -d 127.0.0.0/8 -j RETURN
iptables -t mangle -A clash -d 10.0.0.0/8 -j RETURN
iptables -t mangle -A clash -d 172.16.0.0/12 -j RETURN
iptables -t mangle -A clash -d 192.168.0.0/16 -j RETURN
iptables -t mangle -A clash -d 169.254.0.0/16 -j RETURN
iptables -t mangle -A clash -d 224.0.0.0/4 -j RETURN
iptables -t mangle -A clash -d 240.0.0.0/4 -j RETURN

# 代理対象 IP は 7893 ポートに tproxy 転送し、マークを付与
iptables -t mangle -A clash -d 198.18.0.0/15 -p tcp -j TPROXY --on-port 7893 --tproxy-mark 666
iptables -t mangle -A clash -d 198.18.0.0/15 -p udp -j TPROXY --on-port 7893 --tproxy-mark 666

# 残りのトラフィックは通常処理
iptables -t mangle -A clash -j RETURN

# 全トラフィックを clash チェーンで処理
iptables -t mangle -A PREROUTING -j clash

# clash_local チェーンはゲートウェイ自身のトラフィックを処理
iptables -t mangle -N clash_local

# プライベートネットワークはスキップ
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

# ゲートウェイ発のトラフィックを clash_local チェーンへジャンプ
# clash_local チェーンはマーク付与し、マーク付与済みトラフィックは PREROUTING に戻る
iptables -t mangle -A OUTPUT -j clash_local

# ICMP(ping) の修正
# ping の結果が有効になる保証はない（clash 等は ICMP 転送非対応）が、応答は返るようにする
# --to-destination は到達可能なアドレスに設定
sysctl -w net.ipv4.conf.all.route_localnet=1
iptables -t nat -A PREROUTING -p icmp -d 198.18.0.0/16 -j DNAT --to-destination 127.0.0.1
```

```shell
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

iptables.sh は前回のものとほぼ同じで、clash チェーンの最終処理が `198.18.0.0/15` 宛のトラフィックを 7893 ポートの tproxy に転送し、それ以外はデフォルトルールに従うよう変更しただけです。つまりメインルーターから転送された FakeIP トラフィックを sing-box が処理します。clean.sh は変更なしです。

ここで clash と clash_local の 2 つのチェーンがありますが、名前は前回の方案からの流用でそのままにしています（手抜きです）。

続いて sing-box の設定ファイル例を示します。

```json
{
  "log": {
    "level": "info",
    "output": "box.log",
    "timestamp": true
  },
  "dns": {
    "servers": [
      {
        "tag": "cloudflare",
        "address": "tls://1.1.1.1",
        "detour": "🌍 外网" // ここはあなたの代理ノードのタグに変更してください
      },
      {
        "tag": "local",
        "address": "223.5.5.5",
        "detour": "DIRECT"
      },
      {
        "tag": "dns-fakeip",
        "address": "fakeip"
      },
      {
        "tag": "block",
        "address": "rcode://success"
      }
    ],
    "rules": [
      {
        "server": "block",
        "query_type": [
          "HTTPS",
          "SVCB"
        ]
      },
      {
        "server": "local",
        "outbound": "any"
      },
      {
        "server": "local",
        "rewrite_ttl": 10,
        "type": "logical",
        "mode": "and",
        "rules": [
          {
            "rule_set": [
              "geosite-geolocation-!cn"
            ],
            "invert": true
          },
          {
            "rule_set": [
              "geosite-cn",
              "geosite-category-companies@cn",
              "geoip-cn"
            ]
          }
        ]
      },
      {
        "server": "dns-fakeip",
        "rewrite_ttl": 1,
        "query_type": [
          "A",
          "AAAA"
        ]
      }
    ],
    "strategy": "ipv4_only",
    "fakeip": {
      "enabled": true,
      "inet4_range": "198.18.0.0/15"
    }
  },
  "inbounds": [
    {
      "type": "tproxy",
      "tag": "tproxy-in",
      "listen": "::",
      "listen_port": 7893,
      "tcp_fast_open": true,
      "udp_fragment": true,
      "sniff": true
    },
    {
      "type": "mixed",
      "tag": "mixed-in",
      "listen": "::",
      "listen_port": 7890,
      "tcp_fast_open": true,
      "udp_fragment": true,
      "sniff": true
    },
    {
      "type": "direct",
      "tag": "dns-in",
      "listen": "::",
      "listen_port": 1053
    }
  ],
  "outbounds": [
    {
      "type": "direct",
      "tag": "DIRECT"
    },
    {
      "type": "block",
      "tag": "REJECT"
    },
    {
      "type": "dns",
      "tag": "dns-out"
    },
    // ここにあなたの代理ノードを記述してください
  ],
  "route": {
    "rules": [
      {
        "inbound": "dns-in",
        "outbound": "dns-out"
      },
      {
        "protocol": "dns",
        "outbound": "dns-out"
      },
      {
        "outbound": "DIRECT",
        "type": "logical",
        "mode": "and",
        "rules": [
          {
            "rule_set": [
              "geosite-geolocation-!cn"
            ],
            "invert": true
          },
          {
            "rule_set": [
              "geosite-cn",
              "geosite-category-companies@cn",
              "geoip-cn"
            ]
          }
        ]
      }
    ],
    "rule_set": [
      {
        "type": "remote",
        "tag": "geoip-cn",
        "format": "binary",
        "url": "https://cdn.jsdelivr.net/gh/SagerNet/sing-geoip@rule-set/geoip-cn.srs",
        "download_detour": "DIRECT"
      },
      {
        "type": "remote",
        "tag": "geosite-cn",
        "format": "binary",
        "url": "https://cdn.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-cn.srs",
        "download_detour": "DIRECT"
      },
      {
        "type": "remote",
        "tag": "geosite-geolocation-!cn",
        "format": "binary",
        "url": "https://cdn.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-geolocation-!cn.srs",
        "download_detour": "DIRECT"
      },
      {
        "type": "remote",
        "tag": "geosite-category-companies@cn",
        "format": "binary",
        "url": "https://cdn.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-category-companies@cn.srs",
        "download_detour": "DIRECT"
      }
    ],
    "final": "🌍 外网", // ここはあなたの代理ノードのタグに変更してください
    "auto_detect_interface": true
  },
  "experimental": {
    "clash_api": {
      "external_controller": "0.0.0.0:9090",
      "external_ui": "yacd",
      "external_ui_download_url": "https://github.com/MetaCubeX/Yacd-meta/archive/gh-pages.zip",
      "external_ui_download_detour": "🌍 外网", // ここも代理ノードタグに変更
      "default_mode": "Rule"
    }
  }
}
```

コメント部分は必ず修正してください。デフォルト設定では、中国ドメインの DNS 解決は直接 223.5.5.5 で RealIP を返し（DNS ルール [2]）、その他は FakeIP を返します（DNS ルール [3]）。トラフィック分流時は、中国 IP・ドメインは DIRECT 直結（route ルール [2]）、それ以外は代理経由（route final）となります。

設定完了後、sing-box を自動起動設定し、即座に起動します。

```shell
systemctl enable --now sing-box
```

ログ確認は Debian 標準のツールで行います。

```shell
journalctl -efu sing-box
```

sing-box は clash 互換 API を提供しているため、clash の Web UI も利用可能です。起動後少し待つと（UI をダウンロードするため）、9090 ポートで yacd 画面が開けます。

#### Telegram の問題点

この方案の欠点は明確で、DNS ベースの分流のため、DNS を使わず直接 IP 接続するアプリ（例：Telegram）が正しく分流されません。対策は簡単で、その IP をメインルーターの次ホップゲートウェイの IP リスト、iptables.sh の転送リスト、sing-box のルールに追加し、該当 IP を代理経由に指定すれば解決します。

現在私はスクリプトを作成し、ルールセット中の IP を自動抽出して対応する IP リスト、iptables.sh、sing-box 用 config.json を生成しています。整備・匿名化後にオープンソース化予定ですので、ご期待ください。