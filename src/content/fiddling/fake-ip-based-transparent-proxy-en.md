---
title: Transparent Proxy Routing Based on FakeIP
tags: ["fiddling", "Bypass GFW", "Transparent Proxy", "FakeIP"]
lang: en
published: 2024-08-16T23:53:00+08:00
abbrlink: fiddling/fake-ip-based-transparent-proxy
description: "The FakeIP-based transparent proxy routing solution aims to address the common pitfalls of conventional bypass router setups, such as single points of failure, limited performance, and complex port forwarding. By introducing sing-box as the new proxy core, the solution not only boosts forwarding performance but also streamlines configuration. With richer protocol support and better optimization, sing-box clearly outperforms clash and emerges as a compelling choice for efficient transparent proxies. While similar results are achievable with clash, the adoption of sing-box delivers a more flexible user experience."
---
### Preface

In [the previous article](/en/fiddling/debian-as-bypass-router), I described how to use a bypass router to implement transparent proxying within a local network. While this approach is sufficient for most users, some notable drawbacks remain:

1. **Single point of failure:** Since the DHCP gateway is set to the bypass router, if the clash instance running there becomes unavailable, even regular (non-proxied) websites will become inaccessible.
2. **Poor forwarding performance:** clash's packet forwarding really can't compare to hardware-level routing. With the gateway set to the bypass router and iptables configured, all traffic—proxy or not—gets forwarded through clash, leading to bottlenecks.
3. **Cumbersome port forwarding:** With the extra router in place, port mappings must be duplicated on both the main and the bypass routers.

Recently, I stumbled upon a rising proxy core named **sing-box** (although it's arguably not that new—just gained traction after clash was archived). After checking its [wiki](https://sing-box.sagernet.org/configuration), I found it supports a broad set of protocols and features, and offers better performance optimizations than clash. So, I've chosen to construct this new solution using sing-box as the proxy core.

Of course, you could implement this approach with clash as well—

~~Bad news: you’ll need to bypass the Great Firewall to access the sing-box wiki.~~

### Solution Concept

Both sing-box and clash bundle a DNS module that can function as a DNS server, supporting FakeIP. To put it simply,<mark>when a client initiates a DNS query, the DNS module immediately responds with a fake IP address, while in the background it performs the real DNS lookup and keeps track of the mapping between fake and real IPs. When the client next initiates a connection to this fake IP, the gateway looks up the mapping and forwards the traffic to the true destination.</mark> For more details, see [RFC3089](https://datatracker.ietf.org/doc/html/rfc3089). Because routing decisions later rely on the mappings stored by the DNS module, neither FakeIP nor transparent redirection can be achieved with a standalone DNS server.

FakeIP addresses typically reside in a reserved subnet (usually `198.18.0.0/15`), making routing straightforward and easily distinguishable. We can simply configure the soft router's DNS to respond with FakeIPs only for domains that require proxying, and on the main router, direct packets with FakeIP destinations to the soft router for proxying—everything else is forwarded as usual. Here’s the workflow:

![FakeIP Routing](https://blog-img.shinya.click/2025/e078ffe1fe41b2cbcb04b40a55cbbc56.png)

```
1. For domains that do NOT require proxying
   1. Client initiates a DNS query
   2. DNS module determines proxying isn’t needed, queries a local DNS, and returns the real IP
   3. Client connects using the real IP
   4. Main router recognizes this is NOT a FakeIP, so routes it normally (direct)

2. For domains that DO require proxying
   1. Client initiates a DNS query
   2. DNS module determines proxying is needed, returns a FakeIP, and performs the real DNS lookup upstream
   3. Client connects to the FakeIP
   4. Main router recognizes the FakeIP, routes the traffic to the proxy software
   5. The proxy uses the stored mapping to connect to the true remote IP via the outbound node
```

This approach solves the three major shortcomings of the previous solution:

1. **Eliminates single point of failure:** If sing-box goes down, network connectivity is preserved. Based on the previous architecture, DNS resolution should occur behind AdGuard. If sing-box DNS fails, AdGuard detects an upstream error, switches to a fallback (local) DNS, and since no FakeIP is returned, all traffic is routed normally by the main router.
2. **Non-proxy traffic never touches the proxy core:** Only connections that require a proxy are routed to sing-box, while direct traffic goes through standard routing without added latency or processing.
3. **Port forwarding is simple:** Since all routing is handled by the main router and all clients use it as their gateway, there’s no double NAT and port mappings remain straightforward.

### Implementation Details

#### Main Router Configuration

First, set up the next hop gateway on your main router. In iKuai's interface, this is under Traffic Control Splitting - Splitting Settings - Port Split. Add a splitting rule, selecting next-hop gateway as the method and entering your soft router’s IP (mine is 192.168.7.2). For the destination address, enter 198.18.0.0/15; leave other settings at defaults.

![Next-hop Gateway](https://blog-img.shinya.click/2025/37f3bc2ebbd0f4f79e218c2a949a84c4.png)

This ensures that all traffic destined for 198.18.0.0/15 will be redirected to 192.168.7.2 via the main router.

#### sing-box Installation & Configuration

Refer to [the previous article](/en/fiddling/debian-as-bypass-router) for setting up AdGuard Home, still using 127.0.0.1:1053 as the upstream DNS. Then, install sing-box. On Debian, a single command suffices:

```shell
bash <(curl -fsSL https://sing-box.app/deb-install.sh)
```

Installation instructions for other distributions can be found at [https://sing-box.sagernet.org/installation/package-manager](https://sing-box.sagernet.org/installation/package-manager/#__tabbed_2_1).

The installer automatically creates a systemd service for sing-box. Its service definition is at `/lib/systemd/system/sing-box.service`—edit this file and insert the following three lines before ExecStart:

```shell
ExecStartPre  = +/usr/bin/bash /etc/sing-box/clean.sh
ExecStartPost = +/usr/bin/bash /etc/sing-box/iptables.sh
ExecStopPost  = +/usr/bin/bash /etc/sing-box/clean.sh
```

This works much like the previous solution: routing rules are established on startup and cleaned up when sing-box shuts down. All configs reside under `/etc/sing-box`, which by default is where the service reads `config.json`; we'll stick to this convention.

Create the following two files, `/etc/sing-box/iptables.sh` and `/etc/sing-box/clean.sh`:

<details>
<summary><strong>iptables.sh</strong></summary>

```shell
#!/usr/bin/env bash

set -ex

# ENABLE ipv4 forwarding
sysctl -w net.ipv4.ip_forward=1
# ENABLE ipv6 forwarding
sysctl -w net.ipv6.conf.all.forwarding=1

### IPv4 Routing Rules ###
ip rule add fwmark 666 lookup 666
ip route add local 0.0.0.0/0 dev lo table 666

iptables -t mangle -N clash

# Bypass LAN traffic
iptables -t mangle -A clash -d 0.0.0.0/8 -j RETURN
iptables -t mangle -A clash -d 127.0.0.0/8 -j RETURN
iptables -t mangle -A clash -d 10.0.0.0/8 -j RETURN
iptables -t mangle -A clash -d 172.16.0.0/12 -j RETURN
iptables -t mangle -A clash -d 192.168.0.0/16 -j RETURN
iptables -t mangle -A clash -d 169.254.0.0/16 -j RETURN
iptables -t mangle -A clash -d 224.0.0.0/4 -j RETURN
iptables -t mangle -A clash -d 240.0.0.0/4 -j RETURN

# Proxy traffic for FakeIP through port 7893 with mark
iptables -t mangle -A clash -d 198.18.0.0/15 -p tcp -j TPROXY --on-port 7893 --tproxy-mark 666
iptables -t mangle -A clash -d 198.18.0.0/15 -p udp -j TPROXY --on-port 7893 --tproxy-mark 666

iptables -t mangle -A clash -j RETURN

iptables -t mangle -A PREROUTING -j clash

iptables -t mangle -N clash_local

# Bypass LAN traffic
iptables -t mangle -A clash_local -d 0.0.0.0/8 -j RETURN
iptables -t mangle -A clash_local -d 127.0.0.0/8 -j RETURN
iptables -t mangle -A clash_local -d 10.0.0.0/8 -j RETURN
iptables -t mangle -A clash_local -d 172.16.0.0/12 -j RETURN
iptables -t mangle -A clash_local -d 192.168.0.0/16 -j RETURN
iptables -t mangle -A clash_local -d 169.254.0.0/16 -j RETURN
iptables -t mangle -A clash_local -d 224.0.0.0/4 -j RETURN
iptables -t mangle -A clash_local -d 240.0.0.0/4 -j RETURN

# Mark traffic from gateway itself
iptables -t mangle -A clash_local -p tcp -j MARK --set-mark 666
iptables -t mangle -A clash_local -p udp -j MARK --set-mark 666

# Route local traffic through clash_local
iptables -t mangle -A OUTPUT -j clash_local

# Fix ICMP (ping)
sysctl -w net.ipv4.conf.all.route_localnet=1
iptables -t nat -A PREROUTING -p icmp -d 198.18.0.0/16 -j DNAT --to-destination 127.0.0.1
```
</details>

<details>
<summary><strong>clean.sh</strong></summary>

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
</details>

The changes from the previous (clash-based) iptables script are minimal—mainly, the final rule in the `clash` chain now forwards packets with destination 198.18.0.0/15 to port 7893 (tproxy). In effect, FakeIP traffic routed by the main router is now handled by sing-box's proxy. `clean.sh` remains unchanged.

Both `clash` and `clash_local` chains are retained (‘clash’ is just a namesake from the original script—no sense in reinventing the wheel).

Next, here’s a template for `sing-box` config. Adjust tagged comments as needed:

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
        "detour": "🌍 Proxy" // Change to the tag of your outbound node
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
    }
    // Add your proxy nodes here
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
    "final": "🌍 Proxy", // Change to match your outbound node tag
    "auto_detect_interface": true
  },
  "experimental": {
    "clash_api": {
      "external_controller": "0.0.0.0:9090",
      "external_ui": "yacd",
      "external_ui_download_url": "https://github.com/MetaCubeX/Yacd-meta/archive/gh-pages.zip",
      "external_ui_download_detour": "🌍 Proxy", // Change to your outbound node tag
      "default_mode": "Rule"
    }
  }
}
```

Pay attention to the comments for required adjustments. By default, Chinese domain DNS queries are resolved directly via 223.5.5.5 to real IPs ([see DNS-rules\[2\]]), while other domains are given FakeIP addresses ([see DNS-rules\[3\]]). When routing, all Chinese IPs/domains go DIRECT ([route-rules\[2\]]), everything else goes through your proxy ([route-final]).

Once your config is ready, enable and start sing-box:

```shell
systemctl enable --now sing-box
```

To view logs, use Debian’s standard tooling:

```shell
journalctl -efu sing-box
```

sing-box provides a Clash-compatible API, so you can manage it from the familiar Clash Web UI. After it starts (and automatically downloads the UI), just open port 9090 to access the yacd dashboard.

#### Caveat: Telegram and Direct IP Connections

One major limitation of this DNS-based routing approach is that direct connections to IP addresses—bypassing DNS—will be routed as normal traffic, not proxied. This causes issues for apps like Telegram that use direct IPs. The workaround is simple: add these IPs to your main router’s next-hop list, to the IP list in `iptables.sh`, and to your sing-box config rules to ensure they are routed through the proxy.

Personally, I've written a script to automatically handle IPs in my rule set, generating the necessary lists, iptables rules, and ready-to-use config segments for sing-box. I’m planning to clean it up and open source it soon—stay tuned!