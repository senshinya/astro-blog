---
title: AstroでのGoogle Analytics（タグマネージャー）導入
lang: ja
published: 2025-05-28T22:09:00.000+08:00
tags: ["試行錯誤","Astro","Google Tag Manager","Google Analytics","GTM","partytown"]
abbrlink: fiddling/astro-google-tag-manager
description: "ブログをAstroフレームワークに移行した後、従来のGoogle Analytics導入方法はパフォーマンス面で適さなくなりました。headタグに直接JSコードを追加してイベントを送信することも可能ですが、ページのパフォーマンスに影響を与えます。Astroの高いパフォーマンスを維持するために、partytown技術を用いてスクリプトをメインスレッドから切り離し、読み込みプロセスに影響を与えないようにしました。その上で、デモコードを組み合わせてGoogle Analyticsのシームレスな導入に成功し、パフォーマンスとデータ解析のバランスを実現しました。"
---

### はじめに

無駄話を読みたくない方は、直接「解決策」セクションへどうぞ。

これまでブログのアクセス数やリファラー情報を Google Analytics で確認していました。Hexo や Hugo などの静的ブログフレームワークでは、head タグに JS コードを追加するだけで簡単に Google Analytics を導入できます。先日、ブログを Astro フレームワークに移行しましたが、従来の方法で head 内に JS コードを直接実行してイベントを送信すると、パフォーマンスが低下してしまいます。ご存知の通り、Astro は極限までフロントエンドのパフォーマンスを追求し、可能な限り JS の実行をゼロに近づける設計です。JS でイベント送信を行うと、どうしてもパフォーマンスの損失が発生します。

![パフォーマンスが満杯！](https://blog-img.shinya.click/2025/e1e778992ea6b393ed763a8642db3770.png)

そこでネットを調べてみると、多くのチュートリアルは partytown を使ってスクリプトをメインスレッドから切り離し、メインスレッドの読み込みをブロックしないようにしてパフォーマンスを確保する方法を紹介しており、デモコードも提供されています。これをベースに自分のブログに組み込んでみた結果、以下のようになりました。

![](https://blog-img.shinya.click/2025/e5005b9f2321f6946761eef52156e777.png)

送信が全く行われません。

非常に困惑し、長い間調査を続けましたが原因が見つかりませんでした。ネット上の例はすべて私の方法と同じで、どれも動作しません。奇妙なことに、これらのチュートリアルを書いた人たちは自分でテストしないのでしょうか？まったく使えません。

仕方なく 2 か月ほど放置し、その間は一時的に umami でデータを集めていました。

しかし最近また気になり始め、背中に棘が刺さったような気持ちで再度調査を開始。最終的に GitHub のある [隅っこ](https://github.com/QwikDev/partytown/issues/382#issuecomment-1667675238) で解決策を見つけました。

### 解決策

`@astrojs/partytown` をインストールします。お使いのパッケージマネージャーで簡単に導入可能です。

`<head>` タグ内に以下のコードを追加してください。

```html
<script is:inline src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXX" type="text/partytown"></script>
<script is:inline type="text/partytown">
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
        dataLayer.push(arguments);
    };
  window.gtag('js', new Date());
  window.gtag('config', 'G-XXXXXXXXX');
</script>
```

いくつか注意点があります：
- `is:inline` はスクリプトがクライアント側で実行されることを示します。
- `type="text/partytown"` はスクリプトが partytown によって実行され、メインスレッドでは実行されないことを示します。
- `gtag` 関数は window オブジェクトの関数変数として定義しなければなりません。関数宣言として定義すると動作しません（非常に奇妙です）。

Astro の設定ファイル（`astro.config.ts`や `astro.config.mjs` など）に以下の設定を追加します。

```js
import partytown from '@astrojs/partytown'

export default defineConfig({
  // ...
  integrations: [partytown({ config: { forward: ['dataLayer.push', 'gtag'] } })],
});
```

多くのチュートリアルでは `gtag`を`forward` 配列に追加する必要があることに触れていません。

これで完了です！デプロイ後、Google Analytics の統計データが正常に送信されるようになります。