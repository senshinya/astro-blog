---
title: My heart beats for U —— 心率同步 Grafana 展示
tags: ["折腾","Grafana","心率","Apple Watch"]
published: 2025-03-31T23:51:00+08:00
description: "通过将苹果健康的心率数据定时同步到服务器，使用 Grafana 进行可视化展示，创造了一种直观的健康监测方式。利用 Health Auto Export 应用的 Restful API，将心率信息发送到指定的 http 接口，存储在 InfluxDB 中，最终在 Grafana 中呈现出清晰的看板，便于追踪和分析个人的心率变化。"
---
整了个小活：把苹果健康的心率定时同步到服务器上，并由 Grafana 绘制展示，效果大概如下：

![](https://blog-img.shinya.click/2025/e01807e95f9c8ea4384d2c4d8f4fe3cb.png)

<del>可以点击博客右上角的 ♥️ 标志查看，因为套了 Cloudflare Tunnel，国内访问速度不佳，尽量挂🪜访问。</del>已下线，由于更换了 Oppo 手机，心率无法同步上传了

大概的思路就是使用这个 app [Health Auto Export - JSON+CSV](https://apps.apple.com/us/app/health-auto-export-json-csv/id1115567069?l=zh-Hans-CN) 的 Restful API 的功能，设置定时将心率数据发送到部署的 http 接口以写入 InfluxDB，再由 Grafana 连接 InfluxDB 绘制看板

[Health Auto Export - JSON+CSV](https://apps.apple.com/us/app/health-auto-export-json-csv/id1115567069?l=zh-Hans-CN) 这个 app 如果想要定时同步，需要开通 Premium，Lifetime 美区是 24.99 USD，有点小贵，但似乎也没有什么平替方案

订阅后新建一个 Automation：

* Automation Type 为 `REST API`​
* URL 就是你下面要部署的服务的地址，API 路径为 `/push/heart_rate`​
* Data Type 选择 `Health Metrics`​
* Select Health Metrics 勾选 `Heart Rate`​
* Export Format 选择 JSON
* Sync Cadence 可以选择 1 分钟也可以选择 5 分钟，Apple Watch 并不会一直监测心率

勾上 Enable 即可，为了保证在程序退出后还能同步，可以添加一个桌面小组件

接着就是部署服务开放 Restful API 端口，接收数据并写入 InfluxDB 了。部署 InfluxDB 可以自行 Google 不再赘述，注意服务用的是 InfluxDB 2

服务的源码在 [reekystive/healthkit-collector](https://github.com/reekystive/healthkit-collector)，是个 node 项目，可以直接用 pnpm 启动监听 3000 端口。我写了个 Dockerfile 将其打包成 docker 镜像，部署在家里的服务器上

```go
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

# Set working directory
WORKDIR /app

# Copy package.json and pnpm-lock.yaml
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm build

# Stage 2: Production stage
FROM node:20-alpine AS production

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

# Set working directory
WORKDIR /app

# Copy package.json and pnpm-lock.yaml
COPY package.json pnpm-lock.yaml* ./

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Set environment variables
# These are default values that can be overridden when running the container
ENV NODE_ENV=production
ENV PORT=3000

# Expose the port your app runs on (using the PORT environment variable)
EXPOSE ${PORT}

# Command to run the application
CMD ["node", "dist/index.js"]
```

启动时需要设置四个连接 InfluxDB 使用的环境变量

```
INFLUXDB_TOKEN='your_influxdb_token'
INFLUXDB_URL='your_influxdb_url'
INFLUXDB_ORG='your_influxdb_org'
INFLUXDB_BUCKET='your_influxdb_bucket'
```

部署完成后可以尝试进行一次同步，服务会输出写入 DB 成功的 log

最后就是部署个 Grafana 绘制仪表盘了，添加好 Data Source，新建仪表盘，查询语句如下

```
from(bucket: "bpm")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r["_measurement"] == "heart_rate")
  |> filter(fn: (r) => r["_field"] == "avg" or r["_field"] == "max" or r["_field"] == "min")
```

Enjoy！
