---
title: 更精确的基于 BGP 的国内外 IP 分流
tags: ["折腾","软路由","透明代理","分流","BGP"]
lang: zh
published: 2024-10-07T16:51:00+08:00
abbrlink: fiddling/more-accurate-chnroute
description: "基于 BGP 的国内外 IP 分流方案，提升了透明代理的效率和精准度。通过对国外 IP 进行 FakeIP 标记，主路由能够更智能地进行流量分流，确保网络连接的顺畅性。sing-box 的 DNS 模块配置也进行了相应优化，使得在处理 DNS 请求时，更加灵活且高效，进一步提升整体网络体验。"
---
此前折腾过两节的透明代理方案：[debian 旁路由方案](/fiddling/debian-as-bypass-router) 和 [基于 FakeIP 的透明代理分流](/fiddling/fake-ip-based-transparent-proxy)，家里的透明代理基本已经可用了。基于 FakeIP 的方案使用 FakeIP 标记国外 IP，并在主路由识别并进行分流。sing-box 的 dns 模块配置为

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
              "geosite-geolocation-!cn" // [!code highlight]
            ],
            "invert": true
          },
          {
            "rule_set": [
              "geosite-cn", // [!code highlight]
              "geosite-category-companies@cn", // [!code highlight]
              "geoip-cn" // [!code highlight]
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

这个 dns 分流规则基于规则集：当域名不在 `geosite-geolocation-!cn` 中，且域名在 `geosite-cn` 或者 `geosite-category-companies@cn`，或域名解析出的 ip 在 `geoip-cn` 中时，认为是国内流量，返回 RealIP，否则返回 FakeIP

这种判断方式十分粗糙，且不说这几个域名规则集只能囊括一些常见域名，ip 规则集 `geoip-cn` 是基于 MaxMind 的 GeoLite2 数据库，来自于 WHOIS 数据库，大部分情况只代表这个 IP 被哪个机构注册使用，但无从知晓该 IP 被用在何处，尤其是 CN-IP，十分不准确

正好，最近了解到了 BGP。抄一点科普如下

> 边界网关协议（Border Gateway Protocol，BGP）是一种用来在路由选择域之间交换网络层可达性信息（Network Layer Reachability Information，NLRI）的路由选择协议。由于不同的管理机构分别控制着他们各自的路由选择域，因此，路由选择域经常被称为自治系统 AS（Autonomous System）。现在的 Internet 是一个由多个自治系统相互连接构成的大网络，BGP 作为事实上的 Internet 外部路由协议标准，被广泛应用于 ISP（Internet Service Provider）之间。

基于 BGP，所有路由到中国的流量都会由国内 AS 声明，那么只要收集到国内全部 AS 声明的 IP list，就是一份更加准确的 CN-IP 了

> 根据中国具体国情、维基百科，能够直接与国际互联网建立 BGP Session 只有三大运营商、教育网和科技网

网上有很多教程教你如何自己运营一个 AS，由此拉到一张完整的 BGP 表。但是作为懒狗（拿来主义），我找到 Github 上其实已经有一些基于 BGP 的 CN-IP list。本篇基于这个项目：https://github.com/gaoyifan/china-operator-ip/blob/ip-lists/china.txt

有了 list，下面就是 code time！

```bash
#!/bin/bash

# 定义变量
URL="https://raw.githubusercontent.com/gaoyifan/china-operator-ip/refs/heads/ip-lists/china.txt"
IPSET_NAME="allowed_ips"

# 下载新的 IP 列表
curl -o /tmp/ip-list.txt "$URL" || { echo "下载 IP 列表失败"; exit 1; }

# 清空现有的 ipset 集合
ipset flush $IPSET_NAME

# 重新创建 ipset 集合（如果不存在则创建）
ipset create $IPSET_NAME hash:net -exist

# 添加局域网地址到集合
ipset add $IPSET_NAME 0.0.0.0/8
ipset add $IPSET_NAME 127.0.0.0/8
ipset add $IPSET_NAME 10.0.0.0/8
ipset add $IPSET_NAME 172.16.0.0/12
ipset add $IPSET_NAME 192.168.0.0/16
ipset add $IPSET_NAME 169.254.0.0/16
ipset add $IPSET_NAME 224.0.0.0/4
ipset add $IPSET_NAME 240.0.0.0/4

# 读取 IP 列表并添加到 ipset 集合
while IFS= read -r ip
do
    # 如果行为空或注释行，则跳过
    if [ -z "$ip" ] || [[ $ip == \#* ]]; then
        continue
    fi
    ipset add $IPSET_NAME $ip
done < /tmp/ip-list.txt

# 清理临时文件
rm /tmp/ip-list.txt

# 创建自定义链
iptables -t mangle -N NO_FORWARD

# 配置 iptables：将流量引导到自定义链，并基于逻辑规则返回或标记
iptables -t mangle -A PREROUTING -j NO_FORWARD

# 在自定义链中配置规则
iptables -t mangle -A NO_FORWARD -s 192.168.7.2 -j RETURN
iptables -t mangle -A NO_FORWARD -m set --match-set $IPSET_NAME dst -j RETURN
iptables -t mangle -A NO_FORWARD -j MARK --set-mark 1

# 设置路由以标记的流量转发到 192.168.7.2
ip rule add fwmark 1 table 100
ip route add default via 192.168.7.2 table 100
```

代码注释很完全，不做过多解释

如果你的路由系统是 OpenWRT，需要额外安装 bash、ipset、iptables 等，OpenWRT 的默认 shell 是 ash，无法运行此脚本

```bash
opkg update
opkg install bash
opkg install curl
opkg install ipset
opkg install iptables
```

这份 CN-IP 一天更新一次，可以设置一个定时任务一天执行一次这个脚本，并把这个脚本添加到启动项中