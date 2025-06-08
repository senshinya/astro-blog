---
title: BGPに基づくより正確な国内外IP分流
tags: ["試行錯誤","ソフトルーター","透明プロキシ","分流","BGP"]
lang: ja
published: 2024-10-07T16:51:00+08:00
abbrlink: fiddling/more-accurate-chnroute
description: "BGPに基づく国内外IP分流の方法で、透明プロキシの効率と精度を向上させました。国外IPにFakeIPマークを付けることで、メインルーターがよりスマートにトラフィックを分流し、ネットワーク接続のスムーズさを確保します。sing-boxのDNSモジュール設定も最適化され、DNSリクエスト処理時により柔軟かつ効率的になり、全体のネットワーク体験をさらに向上させています。"
---
これまでに試行した透明プロキシの方法は二つあります：[debian を使ったバイパスルーターの方法](/ja/fiddling/debian-as-bypass-router) と [FakeIP に基づく透明プロキシ分流](/ja/fiddling/fake-ip-based-transparent-proxy) で、我が家の透明プロキシはほぼ使える状態になっています。FakeIP に基づく方法では国外 IP に FakeIP マークを付け、メインルーターがそれを認識して分流を行います。sing-box の dns モジュールの設定は以下の通りです。

```json
{
  "dns": {
    "servers": [
      ...
    ],
    "rules": [
      ...
      {
        "server": "local",
        "rewrite_ttl": 10,
        "type": "logical",
        "mode": "and",
        "rules": [
          {
            "rule_set": [
              "geosite-geolocation-!cn" // [! コード強調]
            ],
            "invert": true
          },
          {
            "rule_set": [
              "geosite-cn", // [! コード強調]
              "geosite-category-companies@cn", // [! コード強調]
              "geoip-cn" // [! コード強調]
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
  }
}
```

この DNS 分流ルールはルールセットに基づいています。ドメイン名が `geosite-geolocation-!cn` に含まれておらず、かつ `geosite-cn` または `geosite-category-companies@cn` に含まれるか、またはドメイン名の解決先 IP が `geoip-cn` に含まれる場合は国内トラフィックとみなし RealIP を返し、それ以外は FakeIP を返します。

しかし、この判定方法は非常に粗雑です。さらに、これらのドメインルールセットは一般的なドメインしかカバーできず、IP ルールセットの `geoip-cn` は MaxMind の GeoLite2 データベースに基づいており、WHOIS データベースから取得されています。多くの場合、この IP がどの機関に登録されているかを示すだけで、その IP がどこで使われているかは分かりません。特に中国の IP（CN-IP）は非常に不正確です。

ちょうど最近 BGP について学びました。簡単に解説を引用します。

> 境界ゲートウェイプロトコル（Border Gateway Protocol、BGP）は、ルーティングドメイン間でネットワーク層到達情報（Network Layer Reachability Information、NLRI）を交換するためのルーティングプロトコルです。異なる管理機関がそれぞれのルーティングドメインを管理しているため、ルーティングドメインは一般に自治システム（AS：Autonomous System）と呼ばれます。現在のインターネットは複数の自治システムが相互接続して構成される大規模ネットワークであり、BGP は事実上のインターネット外部ルーティングプロトコル標準として、ISP（インターネットサービスプロバイダー）間で広く使用されています。

BGP に基づけば、中国へルーティングされるすべてのトラフィックは国内の AS によってアナウンスされます。したがって、国内のすべての AS がアナウンスする IP リストを収集すれば、より正確な CN-IP リストが得られます。

> 中国の具体的な国情やウィキペディアによると、国際インターネットと直接 BGP セッションを確立できるのは三大キャリア、教育ネットワーク、科学技術ネットワークのみです。

ネット上には AS を自分で運用して完全な BGP テーブルを取得する方法を解説したチュートリアルが多数あります。しかし怠け者（流用主義）としては、GitHub 上に既に BGP に基づく CN-IP リストがいくつか存在することを見つけました。本稿ではこちらのプロジェクトを基にします：https://github.com/gaoyifan/china-operator-ip/blob/ip-lists/china.txt

リストが手に入ったので、以下はコードタイムです！

```bash
#!/bin/bash

# 変数定義
URL="https://raw.githubusercontent.com/gaoyifan/china-operator-ip/refs/heads/ip-lists/china.txt"
IPSET_NAME="allowed_ips"

# 新しい IP リストをダウンロード
curl -o /tmp/ip-list.txt "$URL" || { echo "IP リストのダウンロードに失敗しました"; exit 1; }

# 既存の ipset セットをクリア
ipset flush $IPSET_NAME

# ipset セットを再作成（存在しなければ作成）
ipset create $IPSET_NAME hash:net -exist

# ローカルネットワークアドレスをセットに追加
ipset add $IPSET_NAME 0.0.0.0/8
ipset add $IPSET_NAME 127.0.0.0/8
ipset add $IPSET_NAME 10.0.0.0/8
ipset add $IPSET_NAME 172.16.0.0/12
ipset add $IPSET_NAME 192.168.0.0/16
ipset add $IPSET_NAME 169.254.0.0/16
ipset add $IPSET_NAME 224.0.0.0/4
ipset add $IPSET_NAME 240.0.0.0/4

# IP リストを読み込み、ipset セットに追加
while IFS= read -r ip
do
    # 空行またはコメント行はスキップ
    if [ -z "$ip" ] || [[ $ip == \#* ]]; then
        continue
    fi
    ipset add $IPSET_NAME $ip
done < /tmp/ip-list.txt

# 一時ファイルを削除
rm /tmp/ip-list.txt

# カスタムチェーンを作成
iptables -t mangle -N NO_FORWARD

# iptables 設定：トラフィックをカスタムチェーンに誘導し、論理ルールに基づき RETURN またはマークを付与
iptables -t mangle -A PREROUTING -j NO_FORWARD

# カスタムチェーン内のルール設定
iptables -t mangle -A NO_FORWARD -s 192.168.7.2 -j RETURN
iptables -t mangle -A NO_FORWARD -m set --match-set $IPSET_NAME dst -j RETURN
iptables -t mangle -A NO_FORWARD -j MARK --set-mark 1

# マーク付きトラフィックを 192.168.7.2 へルーティングするルール設定
ip rule add fwmark 1 table 100
ip route add default via 192.168.7.2 table 100
```

コード内のコメントは十分なので、詳細な説明は省略します。

もしルーターシステムが OpenWRT の場合は、bash、ipset、iptables などを追加でインストールする必要があります。OpenWRT のデフォルトシェルは ash で、このスクリプトは動作しません。

```bash
opkg update
opkg install bash
opkg install curl
opkg install ipset
opkg install iptables
```

この CN-IP リストは 1 日 1 回更新されるため、1 日 1 回このスクリプトを実行する cron ジョブを設定し、起動時にこのスクリプトを自動実行するようにすると良いでしょう。