---
title: VPSでWarpを使った特定出口のIPv6分流設定
lang: ja
published: 2025-03-15T16:24:00+08:00
tags: ["試行錯誤","検閲回避","warp","分流"]
abbrlink: fiddling/vps-warp-ipv6
description: "ある平凡な午後、Telegramのプッシュ通知が新しいプランへの熱意を呼び起こしました。電信CN2直結、2.5G帯域幅の割引は非常に魅力的です。このプランはIPv6を標準搭載しており、ストリーミングサービスのアンロックに適していますが、すべてのトラフィックをWarp経由にする必要はありません。以前使っていたスクリプトは便利でしたが、速度やトラフィックの振り分けに課題があり、より柔軟な解決策が求められています。"
---

先週のある平凡な午後、長らく静かだったTelegramのバックグラウンドにプッシュ通知が届きました。

![](https://blog-img.shinya.click/2025/c2dcc1d96db444256f1092fb0e15ce3d.png)​

よく見ると、電信CN2直結、2.5G帯域幅、1TBトラフィック、クーポン適用後で年間36ドル、月額約3ドル。

新たな伝家の宝が現れたのです！

即座に支払いを済ませ、友人や同僚数人を誘って皆で契約しました。

このプランはIPv6を標準搭載しており、様々なストリーミングサービスのアンロックに効果的です。もちろん、まだIPv6アドレスを持たないVPSも多く、中国には「狡兎三窟（ずる賢い兎は三つの穴を持つ）」ということわざもあり、外出時には身を隠すための「マント」を着る必要があります。ここで大恩あるCloudflareのWarpが活躍します。

以前使っていたwarpスクリプトは[scarmen/warp](https://gitlab.com/fscarmen/warp)で、全局モードを直接起動するとVPS全体の出口がWarpにリダイレクトされます。しかし、以下の2つの問題がありました。

1. Warpは速度が低下するため、すべての出口トラフィックをWarp経由にする必要はありません。通常、NetflixやOpenAIのようにIPに厳しいサービスのみWarpを経由させれば十分です。
2. Warpが全局トラフィックを制御すると、デュアルスタック出口でも時にIPv4が優先されます。DNS解決はWarp内部（リモートDNS解決）で行われるため、介入が困難です。

問題1については、warpスクリプトで非全局モードを有効にし、ローカルにSOCKSプロキシを開放すれば、プロキシソフトで分流が可能です。問題2については、プロキシソフトでDNS解決をローカルで行い、解決後にWarp出口へトラフィックを流す方法があります。

非全局Warpはインストール時に直接選択可能です。

```shell
wget -N https://gitlab.com/fscarmen/warp/-/raw/main/menu.sh && bash menu.sh c
```

またはインストール後にメニューから選択も可能で、WARP Linux Clientやwireproxyも利用できます。

有効化するとSOCKSはデフォルトでローカルの40000ポートで開放されます。

このSOCKSサービスを利用し、SOCKS出口を追加して必要に応じて分流設定を行います。xrayの場合を例にすると、clashやsing-boxも同様です。

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

プロキシソフトの出口をSOCKS5サービスに設定するとリモートDNS解決が発生し、出口のIPv4/IPv6が不安定になることがあります。これをローカルDNSで解決します。

ローカルDNSにはプロキシソフトのDNSモジュールを有効にします。

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

まずfreedom出口でドメインを解決し、UseIPv6v4はIPv6アドレスを優先、IPv6がなければIPv4を使用します。その後proxySettingsでトラフィックをwarp-inner出口（先ほど設定したSOCKS、すなわちWarp）に流します。

このように、アクセス先のサイトがIPv6対応であれば、warpタグ経由のアクセスは必ずIPv6で行われます。