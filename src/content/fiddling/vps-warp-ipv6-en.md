---
title: "VPS Bundling with Warp: Selective IPv6 Egress with Traffic Splitting"
lang: en
published: 2025-03-15T16:24:00+08:00
tags: ["fiddling","bypass","warp","traffic splitting"]
abbrlink: fiddling/vps-warp-ipv6
description: "On a regular afternoon, a Telegram notification sparked excitement for a new VPS package: direct China Telecom CN2 connectivity, 2.5G bandwidth, and a tempting deal. The package came with built-in IPv6, making it perfect for media unlocking—but not all traffic should run through Warp. While previous scripts were convenient, they lacked speed and flexible traffic control. A more refined solution was clearly needed."
---
One ordinary afternoon last week, my long-dormant Telegram suddenly pinged with a notification:

![](https://blog-img.shinya.click/2025/c2dcc1d96db444256f1092fb0e15ce3d.png)

Looking closer: China Telecom CN2 direct connection, 2.5G bandwidth, 1TB traffic, all for just $36 a year after coupon—only $3 a month.

A new treasure has arrived!

I paid up in a flash, then immediately rounded up several colleagues and convinced three or four of them to pick up the same offer.

This package comes with native IPv6, which is a huge plus for unlocking various streaming services. Of course, not all VPS have IPv6 addresses, and as the Chinese saying goes, “A cunning rabbit keeps three burrows”—when you’re out and about, you still need to put on a disguise. That’s where our benevolent friend, Cloudflare Warp, comes into play.

I used to run the [scarmen/warp](https://gitlab.com/fscarmen/warp) script, which with a single command put the entire VPS behind Warp by default. But two problems quickly emerged:

1. Warp tends to throttle speeds, and not all outbound traffic needs to go through it. Typically, only services like Netflix or OpenAI, which are picky about IP origins, really require Warp.
2. When global Warp is enabled, outbound connections—even on a dual-stack server—sometimes prioritize IPv4. Since DNS is resolved within Warp (remote DNS resolution), you can’t intervene at the local level.

For problem 1, the Warp script does offer a non-global mode, exposing a local SOCKS proxy, allowing you to split your traffic with your preferred proxy handler. For problem 2, you can configure your proxy software to resolve DNS locally—so your system queries the DNS, and only then is traffic routed out via Warp.

To enable non-global Warp, simply select the appropriate option when running the install script:

```shell
wget -N https://gitlab.com/fscarmen/warp/-/raw/main/menu.sh && bash menu.sh c
```

Alternatively, after installation, just choose WARP Linux Client or wireproxy from the menu.

Once enabled, the SOCKS proxy defaults to localhost on port 40000.

With this SOCKS service in place, add it as an outbound in your proxy tool, and then route only the traffic you want through it. Using xray as an example (the same logic applies for clash and sing-box):

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

However, if you simply set your proxy’s outbound to the SOCKS5 service, your DNS queries will be remote-resolved by Warp, which can cause instability between IPv4 and IPv6 egress. The solution is to handle DNS locally inside your proxy software.

That means enabling the DNS module in your proxy configuration:

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

For outbound routing, configure a chained proxy:

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

Here, the `freedom` outbound first resolves the domain—`UseIPv6v4` means it prefers IPv6, and falls back to IPv4 if necessary. The resolved traffic is then passed to the `warp-inner` SOCKS outbound (Warp).

With this setup, if the target website supports IPv6, any traffic routed through the `warp` tag will always exit via IPv6 through Warp.