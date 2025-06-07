---
title: Solving Port Forwarding Failures with Bypass Routers
tags: ["fiddling", "Bypass Router", "NAT", "Port Forwarding"]
lang: en
published: 2024-08-15T23:50:00+08:00
abbrlink: fiddling/fix-port-forward-in-bypass-router
description: "When using a bypass router setup, port forwarding on the primary router often fails. This happens because the gateway configuration of the bypass router changes the forwarding path of network traffic, rendering port forwarding settings on the main router ineffective. The core function of a gateway is to perform address translation, routing internal traffic to the outside world; every internal device requires a gateway to communicate externally. Understanding this mechanism is key to resolving port forwarding failures."
---
### Preface

After configuring [the previous solution](/en/fiddling/debian-as-bypass-router), you might notice that port forwarding set up on your main router stops working if the device to be accessed has its gateway set to the bypass router. This isn’t a problem caused by Clash-based routing—in fact, any setup where a bypass router acts as the gateway will break port forwarding configured on the main router.

### Principle (Too Long; Didn’t Read)

A gateway’s main function is NAT (Network Address Translation): it forwards traffic from your internal network to the external network. To send out any traffic beyond the LAN, each internal device needs to use a gateway.

In effect, the gateway carries out automatic port mapping, keeping a unique port pair for each active connection (identified by a five-tuple). Suppose your machine connects to Google—if the gateway tracks this connection as (32384, 14122), it means any traffic sent to port 32384 on the gateway is forwarded via port 14122 to Google’s servers (and vice versa for responses). Sometimes there’s more than one layer of NAT: if your ISP doesn’t give you a public IP, your home gateway’s upstream will NAT again, and only the outermost gateway with a public IP can communicate with the wider Internet.

When a bypass router acts as the gateway, it performs another round of NAT. So when your computer communicates externally, the path looks like this:

```
Your Device <——> Bypass Router (NAT) <——> Main Router (NAT) <——> External Host
```

If you configure port forwarding on the main router but set the device’s gateway to the bypass router, the incoming (external) connection flows like this:

```
External Host ----> Main Router ----> Your Device
```

But outgoing packets from your device flow like this:

```
Your Device ----> Bypass Router ----> Main Router ----> External Host
```

Here’s the issue: the external host’s incoming connection only establishes a mapping in the main router, but reply traffic from your device goes via the bypass router, which has no record of the port mapping. The bypass router can't find a matching entry and drops the packets, causing the port forward to fail.

### Solution (Just Read This!)

The fix is straightforward: since there are two NAT layers inside your network, you need to replicate the port forwarding on both layers.

1. Set up port forwarding on the main router—target the bypass router.
2. On the bypass router, set up port forwarding again—target the device you actually want to reach.

This way, whether packets are inbound or outbound, the path always looks like this, and connections can be established successfully:

```
Your Device <——> Bypass Router (NAT) <——> Main Router (NAT) <——> External Host
```

The exact method to configure port forwarding on main/bypass routers depends on your system. GUIs for iKuai and OpenWRT make this straightforward, so I won’t repeat those details. In the previous solution, the bypass router runs Debian, but the following method works on any system that uses iptables. Suppose your target device is “Internal” and the gateway machine is “External.” Run:

```shell
iptables -t nat -I PREROUTING -p tcp -d <External IP> --dport <External Port> -j DNAT --to-destination <Internal IP>:<Internal Port>
iptables -t nat -I POSTROUTING -p tcp --dport <Internal Port> -d <External IP> -j SNAT --to-source <Internal IP>
```

After executing these commands, iptables will have the correct port forwarding.

**Note:** The clean.sh script from the previous article contains `iptables -t nat -F`, which will flush all user-defined rules and break forwarding. So after each cleanup, remember to re-apply these commands.