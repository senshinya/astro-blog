---
title: My heart beats for U —— 心拍数同期 Grafana 表示
tags: ["試行錯誤","Grafana","心拍数","Apple Watch"]
lang: ja
published: 2025-03-31T23:51:00+08:00
abbrlink: fiddling/heart-rate-to-grafana
description: "Appleのヘルスケアの心拍数データを定期的にサーバーへ同期し、Grafanaで可視化表示することで、直感的な健康モニタリングを実現しました。Health Auto ExportアプリのRestful APIを利用して心拍情報を指定のHTTPインターフェースに送信し、InfluxDBに保存、最終的にGrafanaで見やすいダッシュボードとして表示。個人の心拍変動を追跡・分析しやすくしています。"
---
ちょっとした試みで、Appleヘルスの心拍数を定期的にサーバーへ同期し、Grafanaで表示する仕組みを作りました。結果はこんな感じです：

![](https://blog-img.shinya.click/2025/e01807e95f9c8ea4384d2c4d8f4fe3cb.png)

<del>ブログ右上の ♥️ アイコンをクリックすると見られますが、Cloudflare Tunnelを使っているため国内からのアクセスは遅いので、できればVPNを使ってアクセスしてください。</del> 現在は停止中です。Oppoスマホに変えたため、心拍数の同期アップロードができなくなりました。

大まかな流れは、こちらのアプリ [Health Auto Export - JSON+CSV](https://apps.apple.com/us/app/health-auto-export-json-csv/id1115567069?l=zh-Hans-CN) のRestful API機能を使い、心拍数データを定期的に指定のHTTPインターフェースへ送信してInfluxDBに書き込み、GrafanaがInfluxDBに接続してダッシュボードを描画するというものです。

[Health Auto Export - JSON+CSV](https://apps.apple.com/us/app/health-auto-export-json-csv/id1115567069?l=zh-Hans-CN) は定期同期を使うにはPremiumプランが必要で、米国ストアのLifetimeは24.99 USDと少し高めですが、代替案はあまりなさそうです。

購読後、新しくAutomationを作成します：

* Automation Typeは `REST API`​
* URLは後述のサービスのアドレスで、APIパスは `/push/heart_rate`​
* Data Typeは `Health Metrics`​
* Select Health Metricsで `Heart Rate` にチェック​
* Export FormatはJSONを選択
* Sync Cadenceは1分または5分を選べますが、Apple Watchは常時心拍を測定しているわけではありません

Enableにチェックを入れればOK。アプリ終了後も同期を続けるために、デスクトップウィジェットを追加しておくと良いです。

次に、Restful APIのエンドポイントを公開するサービスをデプロイし、データを受け取ってInfluxDBに書き込みます。InfluxDBの導入は各自で調べてください。InfluxDBはバージョン2を使っています。

サービスのソースコードは [reekystive/healthkit-collector](https://github.com/reekystive/healthkit-collector) にあり、Node.jsプロジェクトです。pnpmで起動すると3000番ポートで待ち受けます。私はDockerfileを書いてDockerイメージ化し、自宅サーバーにデプロイしました。

```dockerfile
FROM node:20-alpine AS builder

# pnpmをインストール
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

# 作業ディレクトリ設定
WORKDIR /app

# package.jsonとpnpm-lock.yamlをコピー
COPY package.json pnpm-lock.yaml* ./

# 依存関係をインストール
RUN pnpm install --frozen-lockfile

# ソースコードをコピー
COPY . .

# アプリケーションをビルド
RUN pnpm build

# Stage 2: 本番用ステージ
FROM node:20-alpine AS production

# pnpmをインストール
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

# 作業ディレクトリ設定
WORKDIR /app

# package.jsonとpnpm-lock.yamlをコピー
COPY package.json pnpm-lock.yaml* ./

# 本番用依存関係のみインストール
RUN pnpm install --prod --frozen-lockfile

# builderステージからビルド済みアプリをコピー
COPY --from=builder /app/dist ./dist

# 環境変数設定（デフォルト値。実行時に上書き可能）
ENV NODE_ENV=production
ENV PORT=3000

# アプリが使用するポートを公開
EXPOSE ${PORT}

# アプリケーション起動コマンド
CMD ["node", "dist/index.js"]
```

起動時にはInfluxDB接続用の環境変数を4つ設定します。

```
INFLUXDB_TOKEN='your_influxdb_token'
INFLUXDB_URL='your_influxdb_url'
INFLUXDB_ORG='your_influxdb_org'
INFLUXDB_BUCKET='your_influxdb_bucket'
```

デプロイ完了後、一度同期を試みると、サービス側でDB書き込み成功のログが出ます。

最後にGrafanaでダッシュボードを作成します。Data Sourceを追加し、新規ダッシュボードで以下のクエリを使います。

```
from(bucket: "bpm")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r["_measurement"] == "heart_rate")
  |> filter(fn: (r) => r["_field"] == "avg" or r["_field"] == "max" or r["_field"] == "min")
```

ぜひお楽しみください！