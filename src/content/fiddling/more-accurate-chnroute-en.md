---
title: More Accurate Domestic and International IP Routing Based on BGP
tags: ["fiddling", "soft router", "transparent proxy", "routing", "BGP"]
lang: en
published: 2024-10-07T16:51:00+08:00
abbrlink: fiddling/more-accurate-chnroute
description: "A BGP-based domestic and international IP routing scheme that enhances the efficiency and precision of transparent proxies. By tagging foreign IPs with FakeIP, the main router can intelligently route traffic to ensure smooth network connections. The DNS module configuration in sing-box is also optimized for greater flexibility and efficiency when handling DNS queries, further improving the overall network experience."
---
Previously, I experimented with two transparent proxy solutions: [Debian bypass-router setup](/en/fiddling/debian-as-bypass-router) and [FakeIP-based transparent proxy routing](/en/fiddling/fake-ip-based-transparent-proxy). The transparent proxy at home is now basically functional. The FakeIP-based approach uses FakeIP to tag foreign IPs, allowing the main router to identify and route them accordingly. The sing-box DNS module is configured as follows:

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

This DNS routing rule relies on rule sets: if a domain is not in `geosite-geolocation-!cn` but appears in either `geosite-cn` or `geosite-category-companies@cn`, or if the resolved IP falls within `geoip-cn`, it is considered domestic traffic and returns the real IP; otherwise, it returns a FakeIP.

This method is quite crude. Besides the fact that these domain rule sets only cover common domains, the IP rule set `geoip-cn` is based on MaxMind’s GeoLite2 database sourced from WHOIS data. In most cases, it only reflects which organization registered an IP address, but does not reveal how or where the IP is actually used. Especially for CN IPs, accuracy is quite poor.

Coincidentally, I recently learned about BGP. Here’s a bit of background:

> Border Gateway Protocol (BGP) is a routing protocol used to exchange network layer reachability information (NLRI) between different routing domains. Since different administrative entities control their own routing domains, these domains are often called Autonomous Systems (AS). Today’s Internet is a vast network formed by interconnected Autonomous Systems. BGP is the de facto standard external routing protocol on the Internet, widely used between ISPs (Internet Service Providers).

Based on BGP, all traffic routed to China is announced by domestic ASes. Therefore, if we collect all IP ranges announced by Chinese ASes, we obtain a much more accurate CN-IP list.

> According to China’s specific circumstances and Wikipedia, only three major carriers—China Telecom, China Unicom, China Mobile—along with the Educational Network and Science Network, can directly establish BGP sessions with the international Internet.

There are many tutorials online on how to operate your own AS and obtain a full BGP table. But being somewhat lazy and practical, I found that some BGP-based CN-IP lists already exist on GitHub. This post is based on this project: https://github.com/gaoyifan/china-operator-ip/blob/ip-lists/china.txt

Now that we have the list, it’s time for some code!

```bash
#!/bin/bash

# Define variables
URL="https://raw.githubusercontent.com/gaoyifan/china-operator-ip/refs/heads/ip-lists/china.txt"
IPSET_NAME="allowed_ips"

# Download the new IP list
curl -o /tmp/ip-list.txt "$URL" || { echo "Failed to download IP list"; exit 1; }

# Flush existing ipset set
ipset flush $IPSET_NAME

# Create ipset set (create if it doesn’t exist)
ipset create $IPSET_NAME hash:net -exist

# Add local network addresses to the set
ipset add $IPSET_NAME 0.0.0.0/8
ipset add $IPSET_NAME 127.0.0.0/8
ipset add $IPSET_NAME 10.0.0.0/8
ipset add $IPSET_NAME 172.16.0.0/12
ipset add $IPSET_NAME 192.168.0.0/16
ipset add $IPSET_NAME 169.254.0.0/16
ipset add $IPSET_NAME 224.0.0.0/4
ipset add $IPSET_NAME 240.0.0.0/4

# Read the IP list and add entries to the ipset set
while IFS= read -r ip
do
    # Skip empty lines or comments
    if [ -z "$ip" ] || [[ $ip == \#* ]]; then
        continue
    fi
    ipset add $IPSET_NAME $ip
done < /tmp/ip-list.txt

# Clean up temporary file
rm /tmp/ip-list.txt

# Create custom chain
iptables -t mangle -N NO_FORWARD

# Configure iptables to jump traffic to custom chain and return or mark based on logic
iptables -t mangle -A PREROUTING -j NO_FORWARD

# Rules within custom chain
iptables -t mangle -A NO_FORWARD -s 192.168.7.2 -j RETURN
iptables -t mangle -A NO_FORWARD -m set --match-set $IPSET_NAME dst -j RETURN
iptables -t mangle -A NO_FORWARD -j MARK --set-mark 1

# Route marked traffic to 192.168.7.2
ip rule add fwmark 1 table 100
ip route add default via 192.168.7.2 table 100
```

Comments in the code are comprehensive, so I won’t elaborate further here.

If your router system is OpenWRT, you’ll need to install bash, ipset, iptables, etc., since OpenWRT’s default shell is ash, which cannot run this script:

```bash
opkg update
opkg install bash
opkg install curl
opkg install ipset
opkg install iptables
```

This CN-IP list updates once a day. You can set up a scheduled task to run this script daily and add it to your startup scripts for automatic updating.