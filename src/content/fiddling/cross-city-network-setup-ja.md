---
title: 上海と杭州の遠隔ネットワーク構築記録
lang: ja
published: 2025-04-18T16:43:12.812+08:00
tags: ["試行錯誤","透明プロキシ","ソフトルーター","ネットワーク構築","mihomo","tailscale"]
abbrlink: fiddling/cross-city-network-setup
description: "仕事の異動に伴い、彼女が北京から上海へ引っ越し、ついでに光回線の設置も行いました。電信の500M回線を選んだものの、杭州の1000M回線よりも料金が高く、少々困惑しました。そんな状況の中、上海での透明プロキシ設定、一部トラフィックを杭州経由で出口とし、両都市のLAN間通信を実現するための跨都市ネットワーク環境を構築することにしました。杭州のネットワーク構成は比較的シンプルで、ソフトルーターと無線APの組み合わせにより、日常的なトラフィックを自宅に戻すシステムを構築し、今後のネットワーク課題に備えています。"
---
### はじめに

今月、彼女が仕事の都合で北京から上海に引っ越しました。

引っ越しの手伝いに加え、電信の 500M 光回線を契約しました。

ついでに上海電信について少し愚痴を言うと、500M の回線が杭州の 1000M 回線よりも高いのです。

~~光ファイバーが金でできているのか、それとも光猫が金でできているのか？~~

自称ギークとしては、何もしないわけにはいきません。計画した目標は以下の通りです。

1. 上海での透明プロキシによる越境アクセス
2. 上海の一部トラフィックを杭州経由で出口とする
3. 両都市の LAN 間通信を実現する

2 番目の理由は、現在 Netflix などのストリーミングサービスのアンロックに使用している VPN（ここにアフィリエイト挿入可）が利用者数制限があり、複数地域で同時使用するとアカウント停止のリスクがあるため、その場合はトラフィックを杭州に転送し、杭州から一括して出口とする必要があるからです。

### 事前準備

現在、杭州のネットワークトポロジーは非常にシンプルで、光猫からソフトルーターへ PPPoE 接続し、ソフトルーターから TP-Link の無線 AP に接続しています。また、小型 PC がソフトルーターに直結しており、日常的なトラフィックを自宅に戻すための shadowsocks サーバーを稼働させています。ソフトルーターは倍控の G30S（ここに広告挿入可）、CPU は N5100 で十分です。OS は ImmortalWRT を使用しています。以下のプラグインを導入済みです。

* AdguardHome：DNS 広告ブロック
* Nikki：Mihomo カーネルによる透明プロキシ
* Tailscale：仮想 LAN 構築、以前からトラフィックを自宅に戻すために使用
* DDNS-Go：その名の通り DDNS

LAN のネットワークセグメントは 192.168.7.0/24 です。

機器の統一と複雑さの軽減のため、同じ構成の G30S をもう一台購入し、ImmortalWRT をインストールしました。上海のネットワークトポロジーも杭州と同様に、光猫 - ソフトルーター - AP の構成を計画しています。

### インストール

ImmortalWRT のインストールについて少し触れておきます。最初は Windows や他の Linux ディストリビューションのように、ライブ CD やインストーラーイメージを USB に書き込み、そこからインストールするものだと思っていました。ところが、USB 起動するとそのままシステムが起動してしまいました……

起動してしまいました……

つまり、その img ファイル自体がシステムイメージだったのです。

そこで慌てて WinPE を用意し、physdiskwrite でイメージをハードディスクに書き込み、無事起動。簡単な設定でインターネット接続と DHCP を完了しました。上海の LAN セグメントは 192.168.10.0/24 です。

次に容量拡張ですが、直接ディスクに書き込んだ OpenWRT は使用可能容量が 1GB 未満で、残りのディスク領域が無駄になっていました。ここで 2 つ目の難関が現れました：拡張方法の情報が見つからないのです。中国語の解説は複雑で誤りも多く、ほとんどが SquashFS の拡張か、残り領域に新しいパーティションを作りルートパーティションを移す方法ばかりで、本当の意味での「拡張」方法はほとんどありません。

最終的に OpenWRT の [公式ドキュメント](https://openwrt.org/docs/guide-user/advanced/expand_root) で解決策を見つけました……やはり中国語検索はあまり役に立ちませんね。Google でも有用な情報はほとんど出てきません。

まずは越境アクセスとトラフィック出口の問題を解決します。これは clash で簡単に解決可能です。

[Nikki](https://github.com/nikkinikki-org/OpenWrt-nikki) は OpenWRT 用のプラグインで、Mihomo カーネルをベースに透明プロキシを実現します。Passwall や clash など他の類似プラグインと比べてカスタマイズ性が高いのが特徴です。インストールは Readme の Instruction に従う必要があり、Releases から直接 ipk をダウンロードしてもインストールできません（かなり奇妙です）。

::github{repo="nikkinikki-org/OpenWrt-nikki"}

インストール後、設定ファイルをインポートすれば起動可能です。いくつか注意点があります。

1. tun モードを直接有効にすると、自動的にルーターのルーティングテーブルを設定して透明プロキシを実現します。基本的に問題ありません。
2. Mihomo のドメイン分流は DNS リクエストを Mihomo 経由で行う必要があります。方法は 2 つあります。Mihomo の DNS が直接 53 番ポートをハイジャックし、OpenWRT 付属の dnsmasq を別ポートに変更するか、dnsmasq で DNS リクエストを Mihomo の DNS ポートに転送する設定にするかです。
3. FakeIP モードを使用する場合は、FakeIP フィルターの設定を慎重に行ってください。

その他は他プラットフォームでの Mihomo 使用とほぼ同じなので割愛します。

設定完了後、Nikki を起動するとダッシュボードで Mihomo がルーターの全出口トラフィックを管理し始めます。

設定ファイルはほぼ私の環境からそのままコピーしたもので、ほとんどの越境トラフィックは搬瓦工🪜へ直接接続し、一部杭州経由のトラフィックはアウトバウンドを杭州の shadowsocks サーバーに変更しました。遅延も許容範囲内で、国内中継を経由している感覚です。

この段階で、ドメイン名ベースのアクセスは上海から杭州の内網へ到達可能になりました。FakeIP モードのため、DNS 解決後に返される FakeIP へのリクエストも Mihomo カーネルが処理し、ドメインルールに従って杭州へトラフィックを転送します。しかし、直接 IP アドレスでのアクセスは DNS を経由しないため Mihomo で転送できず（tun はデフォルトで LAN 内のリクエストを管理しません）、杭州から上海へのアクセスもできません。

そこで、TailScale の登場です！

OpenWRT で TailScale を使うには [luci-app-tailscale](https://github.com/asvow/luci-app-tailscale) プラグインがあり、比較的直感的に管理・設定が可能です。

::github{repo="asvow/luci-app-tailscale"}

インストール後、まず起動してログイン認証を完了し、設定を行います。TailScale のデバイスキーの有効期限は切らないようにしましょう。

高度な設定では以下を行います。

* ルーティングを有効にする：TailScale が他のサブネットへのルーティングルールを自動設定します。
* DNS を許可しない：IP ルーティングのみ必要なため。
* 公開ネットワークセグメントに 192.168.10.0/24 を設定：このデバイスがこのネットワークのルーティングを担当することを示します。
* サブネット間通信を有効にする：その名の通り。
* サブネットルーティングに 192.168.7.0/24 を選択：このサブネットのルーティングを TailScale が管理します。

杭州側の TailScale も同様に設定し、公開ネットワークとサブネットルーティングはそれぞれのネットワークセグメントに合わせて設定してください。

設定完了後、TailScale を再起動するとサブネット間通信が実現し、上海と杭州の双方から相手側のネットワークセグメントの IP に直接アクセス可能になります。

### あとがき

上海の光回線は「クラウド光回線」なるもので、クラウド光回線をオフにしてブリッジモードに切り替える手続きが非常に面倒（未だ完了していません）。

そのため、上記の設定は上海のソフトルーターにグローバル IP が割り当てられていない状態で行っています。

幸い、杭州側にはグローバル IP があり、TailScale も直接 NAT 越えに成功しており、遅延は十数ミリ秒程度です。もし両側ともグローバル IP がなければ、自力で DERP サーバーを立てるか、数百ミリ秒の遅延を我慢して使うしかありません。

最後にもう一度上海電信に文句を言いたいです。ブリッジモードに切り替えるのに契約書の締結、写真撮影、審査などが必要で、まるで泥棒対策のようです。