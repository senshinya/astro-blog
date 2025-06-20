---
title: macOS 26 / iPadOS 26 先取り体験
tags: ["試行錯誤","macos","ipados","Liquid Glass"]
lang: ja
published: 2025-06-10T20:18:00+08:00
abbrlink: fiddling/macos-26-trial
description: "macOS と iPadOS 26 は新しい Liquid Glass デザイン言語を導入し、インターフェースのスタイルが一新されました。アイコンやウィンドウの効果はよりモダンになり、特に iPad 上で実現されたウィンドウ化アプリモードは、生産性ツールへの転換を象徴しています。しかし、透明なコントロールセンターやランチパッドの統合など、一部のデザインは議論を呼び、ユーザー体験のさらなる改善が求められています。今回のアップデートには課題もありますが、将来の発展の基盤を築くものであり、期待が持てます。"
---

また一年が経ち、WWDC 25 が本日未明に開催されました。ご存知の通り、テクノロジーは見た目の刷新が基本であり、重点的に紹介されたのは<del>中国版では使えない</del>中国のユーザーがあまり使わない Apple Intelligence 以外に、各プラットフォームのシステムが最新版に更新され、年号で統一されたこと、そしてそれに伴う Liquid Glass デザイン言語の導入でした。

私は普段 WWDC にあまり関心がなく、正式版のアップデートを保守的に待つタイプです。しかし今朝は、溢れかえるテックブロガーのレビューやニュース、そして様々なネタ画像の群れに触れ、無視できなくなりました。簡単に内容を把握した後、試しにアップデートしてみることにしました。

![Liquid Glass のインスピレーションはこれだと言われている](https://blog-img.shinya.click/2025/10a1a04fe5272425d5df103b0403286b.png)

私の iPhone はすでに売却済み（[前回の記事](/ja/fiddling/one-month-using-android) 参照）なので、今回は macOS と iPadOS の体験に限定します。この二つのシステムは比較的批判が少ないようです。

まず最も直感的に感じるのは UI の変化です。今回の複数プラットフォームで統一されたデザイン言語 Liquid Glass は、元々 Vision OS から来ていると言われています。私の Vision OS も売ってしまったので直接比較はできませんが、見た目には確かに Vision OS の風味が感じられます。ウィンドウはすべて毛ガラス効果が使われ、アイコンも統一して擬物的（毛ガラスのスライス？とりあえずそう呼びます）なスタイルに変わりました。

![正直ちょっとパチモン感があり、昔の山寨スマホの雰囲気もある](https://blog-img.shinya.click/2025/a8cf24e6e65fb60e3b12459b13dd7b80.png)

iPad 上のアイコンは統一感があり、サードパーティ製アプリのアイコンも効果が適用されていて、スタイルが非常に揃っています。

![iPad のアイコン](https://blog-img.shinya.click/2025/7c1c0ec885660f91df41053898c0cd88.PNG)

ウィンドウも統一されたスタイルに変更され、さらに Apple Music のビジュアルも統一されており、以前の iTunes スタイルのようなぎこちなさはなく、よりテクノロジー感が増しています（もちろん実際の使い勝手は別問題ですが）。

![統一されたウィンドウは見た目に心地よい](https://blog-img.shinya.click/2025/7b73e36fb041c8dc5e7ff9aad0faeb57.png)

macOS で最も批判を浴びているのは Liquid Glass ではなく（UI に対する否定的な反応は主に iPhone から）、ランチパッド（LaunchPad）が廃止されたことです。機能は Spotlight に統合され、Dock 上のアプリボタンをクリックすると Cmd + Space と同様に Spotlight の検索ボックスが表示されます。

![Spotlight](https://blog-img.shinya.click/2025/4b190a366a67d3f5dc14bea1491ebb92.png)

Cmd + 1 を再度押すと、すべてのアプリが表示されます。

![すべてのアプリ画面](https://blog-img.shinya.click/2025/9b74ffbd1b34ef15ef5b320135c653d7.png)

このデザインは少し問題があります。特に私のような物忘れが激しい人間にとっては、アプリ名を覚えられず、かろうじてアイコンを見て機能を思い出すしかありません。LaunchPad と Apple の間に何か因縁でもあるのでしょうか。数日後には独立開発者が LaunchPad の代替アプリを作り、私から 99 元を取るかもしれません。

クイズ：写真アプリは何と呼ばれているでしょうか？「相册（アルバム）」？「图库（ギャラリー）」？

答え：写真（いくつか検索しても違いました）

もう一つの小さなアップデートは、キーボードの音量調整キーや明るさ調整キーを押したときに、全画面の表示が出なくなり、代わりにステータスバー上に小さなポップアップが表示されるようになったことです。タッチスクリーンのロジックに近い感じです。

![音量コントロール](https://blog-img.shinya.click/2025/85841f6a20fe5bc87d2e4e7036e7e1ec.png)
![明るさコントロール](https://blog-img.shinya.click/2025/c781da9ec7dfac96e7588a8faa047df5.png)

iPhone がないため、最もクラシックな Liquid Glass は iPad でしか体験できません。私の iPad は iPad Pro 11 インチ、第 4 世代で、M2 チップ搭載です。

派手なロック画面の時計を伸ばす機能などは試していません。注目したのは通知センターとコントロールセンターです。通知センターを下に引き下げるとリアルタイムのガラス効果があり、まるで本物のガラスを引きずっているかのようで、非常に美しいです。ただし性能面の要求が気になります。古い iPad でも軽快に動くかは不明です。

![境界効果に注目](https://blog-img.shinya.click/2025/acbdd751ce6b1ca0c76301c826274aea.PNG)

そして最も批判を浴びているコントロールセンターは、透明度が高すぎて識別しづらいです。今後のバージョンで調整されるか、ユーザーがカスタマイズできるようになるかもしれません。

![確かに見づらい](https://blog-img.shinya.click/2025/e4cd043a2db8acf7c8a5d12f3c90065e.PNG)

もちろん、今回のアップデートが全くの無意味というわけではありません。最大のハイライトは iPadOS のウィンドウ化アプリモードの更新です。旧バージョンの iPad アプリは全画面表示かスライドオーバーのみで、画面上に一つのアプリしか置けず、分割画面で簡単なマルチタスクをする程度でした。ウィンドウ化アプリの操作ロジックは macOS と完全に同じで、ウィンドウのサイズ変更、最大化、最小化、重ね合わせなど自由自在です。外部ディスプレイに接続すれば、まさにパソコンとして使え、iPad が真の生産性ツールになる重要な一歩と言えます。

![誇張せずに言っても、これは本当にレジェンダリー](https://blog-img.shinya.click/2025/4846d5e04b7811a0435573f43d26dfec.PNG)

以上が今回のアップデートに対する私の率直な感想です。正直なところ、このデザイン言語には大いに期待しています。Windows Vista が当時の性能制約で実現できなかった未来を、Apple がついに実現しました。いくつか深刻な問題や批判は、今後のアップデートで解決されるでしょう。現時点では macOS 26 / iPadOS 26 の最初の開発者プレビュー版に過ぎませんが、将来が楽しみです。