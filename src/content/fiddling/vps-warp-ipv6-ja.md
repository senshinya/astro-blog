---
title: VPSでWarpを使った特定出口のIPv6分流設定
lang: ja
published: 2025-03-15T16:24:00+08:00
tags: ["試行錯誤","検閲回避","warp","分流"]
abbrlink: fiddling/vps-warp-ipv6
description: "ある平凡な午後、Telegramのプッシュ通知が新しいプランへの熱意を呼び起こしました。電信CN2直結、2.5G帯域幅の割引は非常に魅力的です。このプランはIPv6を標準搭載しており、ストリーミングサービスのアンロックに適していますが、すべてのトラフィックをWarp経由にする必要はありません。以前使っていたスクリプトは便利でしたが、速度やトラフィックの振り分けに課題があり、より柔軟な解決策が求められています。"
---

先週のある平凡な午後、長らく静かだった Telegram のバックグラウンドにプッシュ通知が届きました。

![](https://blog-img.shinya.click/2025/c2dcc1d96db444256f1092fb0e15ce3d.png)​

よく見ると、電信 CN2 直結、2.5G 帯域幅、1TB トラフィック、クーポン適用後で年間 36 ドル、月額約 3 ドル。

新たな伝家の宝が現れたのです！

即座に支払いを済ませ、友人や同僚数人を誘って皆で契約しました。

このプランは IPv6 を標準搭載しており、様々なストリーミングサービスのアンロックに効果的です。もちろん、まだ IPv6 アドレスを持たない VPS も多く、中国には「狡兎三窟（ずる賢い兎は三つの穴を持つ）」ということわざもあり、外出時には身を隠すための「マント」を着る必要があります。ここで大恩ある Cloudflare の Warp が活躍します。

以前使っていた warp スクリプトは [scarmen/warp](https://gitlab.com/fscarmen/warp) で、全局モードを直接起動すると VPS 全体の出口が Warp にリダイレクトされます。しかし、以下の 2 つの問題がありました。

1. Warp は速度が低下するため、すべての出口トラフィックを Warp 経由にする必要はありません。通常、Netflix や OpenAI のように IP に厳しいサービスのみ Warp を経由させれば十分です。
2. Warp が全局トラフィックを制御すると、デュアルスタック出口でも時に IPv4 が優先されます。DNS 解決は Warp 内部（リモート DNS 解決）で行われるため、介入が困難です。

問題 1 については、warp スクリプトで非全局モードを有効にし、ローカルに SOCKS プロキシを開放すれば、プロキシソフトで分流が可能です。問題 2 については、プロキシソフトで DNS 解決をローカルで行い、解決後に Warp 出口へトラフィックを流す方法があります。

非全局 Warp はインストール時に直接選択可能です。

```shell
wget -N https://gitlab.com/fscarmen/warp/-/raw/main/menu.sh && bash menu.sh c
```

またはインストール後にメニューから選択も可能で、WARP Linux Client や wireproxy も利用できます。

有効化すると SOCKS はデフォルトでローカルの 40000 ポートで開放されます。

この SOCKS サービスを利用し、SOCKS 出口を追加して必要に応じて分流設定を行います。xray の場合を例にすると、clash や sing-box も同様です。

```json
{
  "outbounds": [
    {
      "tag": "warp",
      "protocol": "socks",
      "settings": {
        "servers": [
          {
            "address": "127.0.0.1",
            "port": 40000
          }
        ]
      }
    }
  ]
}
```

プロキシソフトの出口を SOCKS5 サービスに設定するとリモート DNS 解決が発生し、出口の IPv4/IPv6 が不安定になることがあります。これをローカル DNS で解決します。

ローカル DNS にはプロキシソフトの DNS モジュールを有効にします。

```json
{
  "dns": {
    "servers": [
      "2606:4700:4700::1111",
      "1.1.1.1"
    ],
    "queryStrategy": "UseIP",
    "tag": "dns_inbound"
  }
}
```

出口はチェーン型プロキシとして設定します。

```json
{
  "outbounds": [
    {
      "tag": "warp",
      "protocol": "freedom",
      "settings": {
        "domainStrategy": "UseIPv6v4"
      },
      "proxySettings": {
        "tag": "warp-inner"
      }
    },
    {
      "tag": "warp-inner",
      "protocol": "socks",
      "settings": {
        "servers": [
          {
            "address": "127.0.0.1",
            "port": 40000
          }
        ]
      }
    }
  ]
}
```

まず freedom 出口でドメインを解決し、UseIPv6v4 は IPv6 アドレスを優先、IPv6 がなければ IPv4 を使用します。その後 proxySettings でトラフィックを warp-inner 出口（先ほど設定した SOCKS、すなわち Warp）に流します。

このように、アクセス先のサイトが IPv6 対応であれば、warp タグ経由のアクセスは必ず IPv6 で行われます。