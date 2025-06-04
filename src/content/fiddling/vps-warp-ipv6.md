---
title: VPS 套 Warp 分流指定出口 IPv6
published: 2025-03-15T16:24:00+08:00
tags: ["折腾","翻墙","warp","分流"]
description: "在一个平常的下午，Telegram 推送消息引发了对一个新套餐的热情，电信 CN2 直连、2.5G 带宽的优惠让人兴奋不已。这个套餐自带 IPv6，适合解锁流媒体，但仍需谨慎使用，毕竟并不是所有流量都需要通过 Warp 来处理。先前使用的脚本虽然方便，但在速度和流量分配上存在不足，显然需要寻找更灵活的解决方案。"
---
上周一个普通的下午，一直挂在后台沉寂许久的 Telegram 收到了一条推送：

![](https://blog-img.shinya.click/2025/c2dcc1d96db444256f1092fb0e15ce3d.png)​

定睛一看，电信 CN2 直连，2.5G 带宽，1T 流量，券后 36 刀一年，合 3 刀一个月

新的传家宝已经出现！

火速付款之余，立即呼朋唤友，忽悠了周围三四个同事都入手了

这个套餐是自带 IPv6 的，对于各种流媒体解锁都有好处。当然依然有很多 VPS 没有 IPv6 地址，并且中国有句古话叫狡兔三窟，出门在外还是得套个马甲的。这时候就需要用到大善人 Cloudflare 家的 Warp 了

此前使用的 warp 脚本是 [scarmen/warp](https://gitlab.com/fscarmen/warp)，直接启动全局模式，就会将整个 VPS 的全局出口都重定位到 warp。但是有两点问题：

1. warp 降速，并非所有的出口流量都需要走 warp。通常只有一些如 Netflix、OpenAI 之类的对 IP 要求比较高的服务需要走 warp
2. warp 接管全局流量后，即使是双栈出口，但是有时出口会优先走 IPv4。由于 DNS 解析发生在 warp 内部（远程 DNS 解析），无法做干预

对于问题 1，warp 脚本可以开启非全局模式，并在本地开放一个 socks 代理，可以使用代理软件分流。对于问题 2，则可以通过代理软件让 DNS 解析发生在本地，完成解析后再将流量通过 warp 出口

非全局的 warp，可以在安装脚本时直接选择

```shell
wget -N https://gitlab.com/fscarmen/warp/-/raw/main/menu.sh && bash menu.sh c
```

也可以安装完成后在菜单中选择，WARP Linux Client 或 wireproxy 都可以

开启后 socks 默认会开放在本机 40000 端口

有了这个 socks 服务，添加 socks 出口，再根据需要分流即可。以 xray 为例，clash 和 sing-box 类似

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

直接设置代理软件的出口为 socks5 服务，就会触发远程 DNS 解析，导致出口 IPv4/IPv6 不稳定，这里可以通过本地 DNS 的方式解决

本地 dns 就需要代理软件开启 dns 模块

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

出口添加为一个链式代理

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

先通过一个 freedom 出口解析域名，UseIPv6v4 表示优先使用解析出的 IPv6 地址，如果没有 IPv6 再使用 IPv4，再通过 proxySettings 将流量导入 warp-inner 出口，也就是之前设置的 socks，即 warp

这样如果访问的网站支持 IPv6，那么通过 warp tag 访问该网站就必然通过 IPv6 访问
