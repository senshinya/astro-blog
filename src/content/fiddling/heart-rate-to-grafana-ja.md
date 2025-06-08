---
title: My heart beats for U —— 心拍数同期 Grafana 表示
tags: ["試行錯誤","Grafana","心拍数","Apple Watch"]
lang: ja
published: 2025-03-31T23:51:00+08:00
abbrlink: fiddling/heart-rate-to-grafana
description: "Appleのヘルスケアの心拍数データを定期的にサーバーへ同期し、Grafanaで可視化表示することで、直感的な健康モニタリングを実現しました。Health Auto ExportアプリのRestful APIを利用して心拍情報を指定のHTTPインターフェースに送信し、InfluxDBに保存、最終的にGrafanaで見やすいダッシュボードとして表示。個人の心拍変動を追跡・分析しやすくしています。"
---
ちょっとした試みで、Apple ヘルスの心拍数を定期的にサーバーへ同期し、Grafana で表示する仕組みを作りました。結果はこんな感じです：

![](https://blog-img.shinya.click/2025/e01807e95f9c8ea4384d2c4d8f4fe3cb.png)

<del>ブログ右上の ♥️ アイコンをクリックすると見られますが、Cloudflare Tunnel を使っているため国内からのアクセスは遅いので、できれば VPN を使ってアクセスしてください。</del> 現在は停止中です。Oppo スマホに変えたため、心拍数の同期アップロードができなくなりました。

大まかな流れは、こちらのアプリ [Health Auto Export - JSON+CSV](https://apps.apple.com/us/app/health-auto-export-json-csv/id1115567069?l=zh-Hans-CN) の Restful API 機能を使い、心拍数データを定期的に指定の HTTP インターフェースへ送信して InfluxDB に書き込み、Grafana が InfluxDB に接続してダッシュボードを描画するというものです。

[Health Auto Export - JSON+CSV](https://apps.apple.com/us/app/health-auto-export-json-csv/id1115567069?l=zh-Hans-CN) は定期同期を使うには Premium プランが必要で、米国ストアの Lifetime は 24.99 USD と少し高めですが、代替案はあまりなさそうです。

購読後、新しく Automation を作成します：

* Automation Type は `REST API`​
* URL は後述のサービスのアドレスで、API パスは `/push/heart_rate`​
* Data Type は `Health Metrics`​
* Select Health Metrics で `Heart Rate` にチェック​
* Export Format は JSON を選択
* Sync Cadence は 1 分または 5 分を選べますが、Apple Watch は常時心拍を測定しているわけではありません

Enable にチェックを入れれば OK。アプリ終了後も同期を続けるために、デスクトップウィジェットを追加しておくと良いです。

次に、Restful API のエンドポイントを公開するサービスをデプロイし、データを受け取って InfluxDB に書き込みます。InfluxDB の導入は各自で調べてください。InfluxDB はバージョン 2 を使っています。

サービスのソースコードは [reekystive/healthkit-collector](https://github.com/reekystive/healthkit-collector) にあり、Node.js プロジェクトです。pnpm で起動すると 3000 番ポートで待ち受けます。私は Dockerfile を書いて Docker イメージ化し、自宅サーバーにデプロイしました。

```dockerfile
FROM node:20-alpine AS builder

# pnpm をインストール
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

# 作業ディレクトリ設定
WORKDIR /app

# package.json と pnpm-lock.yaml をコピー
COPY package.json pnpm-lock.yaml* ./

# 依存関係をインストール
RUN pnpm install --frozen-lockfile

# ソースコードをコピー
COPY . .

# アプリケーションをビルド
RUN pnpm build

# Stage 2: 本番用ステージ
FROM node:20-alpine AS production

# pnpm をインストール
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

# 作業ディレクトリ設定
WORKDIR /app

# package.json と pnpm-lock.yaml をコピー
COPY package.json pnpm-lock.yaml* ./

# 本番用依存関係のみインストール
RUN pnpm install --prod --frozen-lockfile

# builder ステージからビルド済みアプリをコピー
COPY --from=builder /app/dist ./dist

# 環境変数設定（デフォルト値。実行時に上書き可能）
ENV NODE_ENV=production
ENV PORT=3000

# アプリが使用するポートを公開
EXPOSE ${PORT}

# アプリケーション起動コマンド
CMD ["node", "dist/index.js"]
```

起動時には InfluxDB 接続用の環境変数を 4 つ設定します。

```
INFLUXDB_TOKEN='your_influxdb_token'
INFLUXDB_URL='your_influxdb_url'
INFLUXDB_ORG='your_influxdb_org'
INFLUXDB_BUCKET='your_influxdb_bucket'
```

デプロイ完了後、一度同期を試みると、サービス側で DB 書き込み成功のログが出ます。

最後に Grafana でダッシュボードを作成します。Data Source を追加し、新規ダッシュボードで以下のクエリを使います。

```
from(bucket: "bpm")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r["_measurement"] == "heart_rate")
  |> filter(fn: (r) => r["_field"] == "avg" or r["_field"] == "max" or r["_field"] == "min")
```

ぜひお楽しみください！