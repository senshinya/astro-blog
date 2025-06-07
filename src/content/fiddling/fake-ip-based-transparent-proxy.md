---
title: 基于 FakeIP 的透明代理分流
tags: ["折腾","翻墙","透明代理","FakeIP"]
lang: zh
published: 2024-08-16T23:53:00+08:00
abbrlink: fiddling/fake-ip-based-transparent-proxy
description: "基于 FakeIP 的透明代理分流方案旨在解决传统旁路由的单点故障、性能不足及复杂的端口映射问题。通过引入新的代理内核 sing-box，不仅提升了转发性能，还简化了配置流程。sing-box 提供了更丰富的协议支持，其优化效果明显优于原先的 clash，成为实现高效透明代理的新选择。虽然这也可以通过 clash 实现，但 sing-box 的引入无疑为用户带来了更灵活的体验。"
---
### 前言

[上篇文章](/fiddling/debian-as-bypass-router) 中介绍了使用旁路由做局域网内透明代理的方案，对于大部分用户已经基本可用，但是该方案的 cons 也比较明显：

1. 存在单点故障的可能，由于 DHCP 下发的网关直接指向了旁路由，一旦旁路由的 clash 不可用，即使不需要科学的网站也无法访问
2. clash 包转发性能孱弱，远比不上硬件转发。而一旦网关设置为旁路由，由于 iptables 的设置，无论是否需要科学的流量都会走 clash 转发
3. 由于存在旁路由网关，端口映射需要同时在主路由和旁路由配置

正好，最近看到了一个新兴的代理内核 sing-box（似乎也不新兴了，只是从 clash archive 后才火起来）。看了下 [Wiki](https://sing-box.sagernet.org/configuration)，支持的协议和功能十分全面，在性能优化上也比 clash 要好。新方案的代理核心就直接用 sing-box 了。

当然该方案也可以用 clash 实现就是了（

~~坏消息，sing-box 的 wiki 需要越墙才可访问~~

### 方案思路

sing-box 和 clash 都内置了 DNS 模块，实现了 DNS Server 了功能，且都有 FakeIP。关于 FakeIP，可以理解为当<mark>客户端进行 DNS 查询时，DNS 模块立刻响应一个假的 IP 地址，并在后台进行实际的 DNS 查询过程，并维护这个假 IP 地址和实际 IP 的映射关系。当后续客户端拿着这个 FakeIP 来建立连接发送数据时，网关即可根据这个映射关系向真实的 IP 发起请求。</mark>更具体的描述可见 [RFC3089](https://datatracker.ietf.org/doc/html/rfc3089)。由于后续进行流量路由时需要用到 DNS 应答时存储的 FakeIP 和真实 IP 映射，所以单纯的 DNS Server 无法单独实现 FakeIP 机制。

由于 FakeIP 通常位于一个保留网段（大部分配置为 `198.18.0.0/15`），分流特征及其明显，分流也十分简单。我们可以直接让软路由代理的 DNS 模块仅对需要代理的域名响应 FakeIP，在主路由中配置下一跳，仅让目标 IP 为 FakeIP 的流量通过软路由代理，非 FakeIP 的流量正常转发。具体如下

 ![fakeIP 分流](https://blog-img.shinya.click/2025/e078ffe1fe41b2cbcb04b40a55cbbc56.png)

```
1. 无须科学的域名
  1. 客户端发起 DNS 解析
  2. DNS 模块判断为无须科学，向国内 DNS 请求，返回 RealIP
  3. 客户端使用 RealIP 发起请求
  4. 主路由判断不是 FakeIP，走默认路由（直连）
  
2. 需要科学的域名
  1. 客户端发起 DNS 解析
  2. DNS 模块判断为需要科学，返回 FakeIP，并向国外 DNS 请求
  3. 客户端使用 FakeIP 发起请求
  4. 主路由判断是 FakeIP，路由流量到代理软件
  5. 代理软件根据 FakeIP 映射，通过出口节点向国外 IP 发起请求
```

这个方案解决了上篇文章的三个 cons：


1. 单点故障问题，避免了 sing-box 失效导致无法联网。基于上篇文章的方案，sing-box 的 DNS 解析应当位于 AdGuard 后，当 sing-box 失效时，AdGuard 发现上游 DNS 异常，会启用后备 DNS，即国内 DNS。由于不返回 FakeIP，所有流量在主路由分流时都会走默认路由
2. 该方案无须科学的流量不会走代理软件转发，而是直接走路由转发
3. 由于转发是由主路由路由表进行，所有客户端网关都为主路由，不存在二层 NAT，主路由端口映射不会失效

### 具体实现

#### 主路由配置

首先在主路由配置下一跳网关，ikuai 的配置位于 流控分流 - 分流设置 - 端口分流，添加一条分流规则，分流方式选择下一跳网关，并填写你的软路由 IP，我的就是 192.168.7.2 了。并在目的地址中添加一条 198.18.0.0/15，其他配置保持默认即可

 ![下一跳网关](https://blog-img.shinya.click/2025/37f3bc2ebbd0f4f79e218c2a949a84c4.png)

这样所有目标地址为 198.18.0.0/15 的流量经过主路由时都会被转发到 192.168.7.2 了

#### sing-box 安装和配置

使用 [上篇文章](/fiddling/debian-as-bypass-router) 的教程搭建好 AdGuard Home，上游 DNS 仍然设置为 127.0.0.1:1053。之后安装 sing-box，Debian 机器只需要一条命令：

```shell
bash <(curl -fsSL https://sing-box.app/deb-install.sh)
```

其他发行版的安装方法可在 [https://sing-box.sagernet.org/installation/package-manager](https://sing-box.sagernet.org/installation/package-manager/#__tabbed_2_1) 中找到。

安装程序会自动创建 systemd service。sing-box 的 systemd service 比较不走寻常路，定义位于 `/lib/systemd/system/sing-box.service`，编辑这个文件，在 ExecStart 前加上这三行：

```shell
ExecStartPre  = +/usr/bin/bash /etc/sing-box/clean.sh
ExecStartPost = +/usr/bin/bash /etc/sing-box/iptables.sh
ExecStopPost  = +/usr/bin/bash /etc/sing-box/clean.sh
```

这其实和上个方案类似，也是在启动时设置路由表，并在 sing-box 关闭时清除。sing-box 的所有配置都位于 `/etc/sing-box` 下，默认读取的配置文件也是 `/etc/sing-box/config.json`，所以我们也保持统一。

新建 `/etc/sing-box/iptables.sh` 和 `/etc/sing-box/clean.sh` 如下：

```shell
#!/usr/bin/env bash

set -ex

# ENABLE ipv4 forward
sysctl -w net.ipv4.ip_forward=1
# ENABLE ipv6 forward
sysctl -w net.ipv6.conf.all.forwarding=1

### IPv4 Routing Rules ###
# ROUTE RULES
ip rule add fwmark 666 lookup 666
ip route add local 0.0.0.0/0 dev lo table 666

# clash 链负责处理转发流量
iptables -t mangle -N clash

# 跳过内网流量
iptables -t mangle -A clash -d 0.0.0.0/8 -j RETURN
iptables -t mangle -A clash -d 127.0.0.0/8 -j RETURN
iptables -t mangle -A clash -d 10.0.0.0/8 -j RETURN
iptables -t mangle -A clash -d 172.16.0.0/12 -j RETURN
iptables -t mangle -A clash -d 192.168.0.0/16 -j RETURN
iptables -t mangle -A clash -d 169.254.0.0/16 -j RETURN
iptables -t mangle -A clash -d 224.0.0.0/4 -j RETURN
iptables -t mangle -A clash -d 240.0.0.0/4 -j RETURN

# 需代理的 IP 转向到 7893 端口，并打上 mark
iptables -t mangle -A clash -d 198.18.0.0/15 -p tcp -j TPROXY --on-port 7893 --tproxy-mark 666
iptables -t mangle -A clash -d 198.18.0.0/15 -p udp -j TPROXY --on-port 7893 --tproxy-mark 666

# 剩余流量正常处理
iptables -t mangle -A clash -j RETURN

# 最后让所有流量通过 clash 链进行处理
iptables -t mangle -A PREROUTING -j clash

# clash_local 链负责处理网关本身发出的流量
iptables -t mangle -N clash_local

# 跳过内网流量
iptables -t mangle -A clash_local -d 0.0.0.0/8 -j RETURN
iptables -t mangle -A clash_local -d 127.0.0.0/8 -j RETURN
iptables -t mangle -A clash_local -d 10.0.0.0/8 -j RETURN
iptables -t mangle -A clash_local -d 172.16.0.0/12 -j RETURN
iptables -t mangle -A clash_local -d 192.168.0.0/16 -j RETURN
iptables -t mangle -A clash_local -d 169.254.0.0/16 -j RETURN
iptables -t mangle -A clash_local -d 224.0.0.0/4 -j RETURN
iptables -t mangle -A clash_local -d 240.0.0.0/4 -j RETURN

# 为本机发出的流量打 mark
iptables -t mangle -A clash_local -p tcp -j MARK --set-mark 666
iptables -t mangle -A clash_local -p udp -j MARK --set-mark 666

# 让本机发出的流量跳转到 clash_local
# clash_local 链会为本机流量打 mark, 打过 mark 的流量会重新回到 PREROUTING 上
iptables -t mangle -A OUTPUT -j clash_local

# 修复 ICMP(ping)
# 这并不能保证 ping 结果有效 (clash 等不支持转发 ICMP), 只是让它有返回结果而已
# --to-destination 设置为一个可达的地址即可
sysctl -w net.ipv4.conf.all.route_localnet=1
iptables -t nat -A PREROUTING -p icmp -d 198.18.0.0/16 -j DNAT --to-destination 127.0.0.1
```

```shell
#!/usr/bin/env bash

set -ex

ip rule del fwmark 666 table 666 || true
ip route del local 0.0.0.0/0 dev lo table 666 || true

iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X clash || true
iptables -t mangle -X clash_local || true
```

iptables.sh 其实和上篇文章的 iptables.sh 高度相似，只是最终 clash 链的最终处理变为了：将目标地址为 198.18.0.0/15 的流量转发到 7893 的 tproxy 端口，其他流量则走默认规则。实际上就是将被主路由转发的 FakeIP 流量交给 sing-box 处理了。clean.sh 则完全没有变化。

这里两个处理链：clash 和 clash_local，我还是保留了 clash 的名称，因为实际上就是从 clash 方案简单修改来的。（偷懒）

接着就是 sing-box 的配置文件，我这里给出一份配置模板：

```json
{
  "log": {
    "level": "info",
    "output": "box.log",
    "timestamp": true
  },
  "dns": {
    "servers": [
      {
        "tag": "cloudflare",
        "address": "tls://1.1.1.1",
        "detour": "🌍 外网" // 改为你的代理节点 tag
      },
      {
        "tag": "local",
        "address": "223.5.5.5",
        "detour": "DIRECT"
      },
      {
        "tag": "dns-fakeip",
        "address": "fakeip"
      },
      {
        "tag": "block",
        "address": "rcode://success"
      }
    ],
    "rules": [
      {
        "server": "block",
        "query_type": [
          "HTTPS",
          "SVCB"
        ]
      },
      {
        "server": "local",
        "outbound": "any"
      },
      {
        "server": "local",
        "rewrite_ttl": 10,
        "type": "logical",
        "mode": "and",
        "rules": [
          {
            "rule_set": [
              "geosite-geolocation-!cn"
            ],
            "invert": true
          },
          {
            "rule_set": [
              "geosite-cn",
              "geosite-category-companies@cn",
              "geoip-cn"
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
  },
  "inbounds": [
    {
      "type": "tproxy",
      "tag": "tproxy-in",
      "listen": "::",
      "listen_port": 7893,
      "tcp_fast_open": true,
      "udp_fragment": true,
      "sniff": true
    },
    {
      "type": "mixed",
      "tag": "mixed-in",
      "listen": "::",
      "listen_port": 7890,
      "tcp_fast_open": true,
      "udp_fragment": true,
      "sniff": true
    },
    {
      "type": "direct",
      "tag": "dns-in",
      "listen": "::",
      "listen_port": 1053
    }
  ],
  "outbounds": [
    {
      "type": "direct",
      "tag": "DIRECT"
    },
    {
      "type": "block",
      "tag": "REJECT"
    },
    {
      "type": "dns",
      "tag": "dns-out"
    },
    // 此处填写你的代理节点
  ],
  "route": {
    "rules": [
      {
        "inbound": "dns-in",
        "outbound": "dns-out"
      },
      {
        "protocol": "dns",
        "outbound": "dns-out"
      },
      {
        "outbound": "DIRECT",
        "type": "logical",
        "mode": "and",
        "rules": [
          {
            "rule_set": [
              "geosite-geolocation-!cn"
            ],
            "invert": true
          },
          {
            "rule_set": [
              "geosite-cn",
              "geosite-category-companies@cn",
              "geoip-cn"
            ]
          }
        ]
      }
    ],
    "rule_set": [
      {
        "type": "remote",
        "tag": "geoip-cn",
        "format": "binary",
        "url": "https://cdn.jsdelivr.net/gh/SagerNet/sing-geoip@rule-set/geoip-cn.srs",
        "download_detour": "DIRECT"
      },
      {
        "type": "remote",
        "tag": "geosite-cn",
        "format": "binary",
        "url": "https://cdn.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-cn.srs",
        "download_detour": "DIRECT"
      },
      {
        "type": "remote",
        "tag": "geosite-geolocation-!cn",
        "format": "binary",
        "url": "https://cdn.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-geolocation-!cn.srs",
        "download_detour": "DIRECT"
      },
      {
        "type": "remote",
        "tag": "geosite-category-companies@cn",
        "format": "binary",
        "url": "https://cdn.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-category-companies@cn.srs",
        "download_detour": "DIRECT"
      }
    ],
    "final": "🌍 外网", // 改为你的代理节点 tag
    "auto_detect_interface": true
  },
  "experimental": {
    "clash_api": {
      "external_controller": "0.0.0.0:9090",
      "external_ui": "yacd",
      "external_ui_download_url": "https://github.com/MetaCubeX/Yacd-meta/archive/gh-pages.zip",
      "external_ui_download_detour": "🌍 外网", // 改为你的代理节点 tag
      "default_mode": "Rule"
    }
  }
}
```

注意几个注释的地方需要修改。默认配置中，会将中国域名的 DNS 解析直接通过 223.5.5.5 解析成 RealIP（见 DNS-rules\[2\]），其他域名解析为 FakeIP（见 DNS-rules\[3\]）。并在进行流量分流时，将所有中国 IP 和域名都走 DIRECT 直连（见 route-rules\[2\]），其他流量都走代理（见 route-final）。

完全配置好以后，我们可以设置 sing-box 为开启自动启动，并立即启动起来。

```shell
systemctl enable --now sing-box
```

后续如想查看日志，我们直接使用 Debian 自带的工具来查看：

```shell
journalctl -efu sing-box
```

由于 sing-box 提供了兼容 clash 的 api，所以也可以直接使用 clash 的 web ui 进行管理。在启动后稍等一会（sing-box 下载 ui），即可通过 9090 端口打开 yacd 界面了。

#### Telegram 问题

此方案的缺点也很明显，由于基于 DNS 分流，不走 DNS 的直接 IP 流量都会被主路由直接直连，导致像 Telegram 之类的直接使用 IP 的 APP 无法正确分流。解决方法也很简单，将这个 IP 加到主路由下一跳网关的 IP List，iptables.sh 的转发列表，和 sing-box 配置中的 rules 中，指定该 IP 走代理即可。

当前我是写了个脚本帮我自动处理规则集中的 IP，生成对应的 IP List、iptables.sh 和可直接用于 sing-box 的 config.json 配置文件。待我加工加工，脱敏后开源，敬请期待吧。