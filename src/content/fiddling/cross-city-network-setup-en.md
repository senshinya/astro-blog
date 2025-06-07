---
title: "Cross-City Network Setup: Shanghai & Hangzhou Experience"
lang: en
published: 2025-04-18T16:43:12.812+08:00
tags: ["fiddling", "transparent proxy", "soft router", "networking", "mihomo", "tailscale"]
abbrlink: fiddling/cross-city-network-setup
description: "Due to my girlfriend’s job transfer, she recently moved from Beijing to Shanghai, so I helped her get settled and took care of the broadband installation. Despite signing up for a 500M China Telecom connection, the price was even higher than the 1000M plan in Hangzhou—pretty frustrating! Against this backdrop, I decided to engineer a cross-city network setup allowing for transparent proxy in Shanghai, routing some traffic out via Hangzhou, and seamless LAN communication between both locations. The Hangzhou side was straightforward: a soft router paired with a wireless AP provided a stable ‘home-routing’ solution. Now, it’s time for a new networking challenge!"
---
### Preface

This month, my girlfriend moved from Beijing to Shanghai for work.

Besides helping her with the move, I also helped set up a broadband connection—a 500M fiber from China Telecom.

Quick rant: Shanghai Telecom’s 500M plan is *more expensive* than Hangzhou’s 1000M plan.

~~What’s that, is the optical fiber made of gold? Or is the modem lined with gold?~~

As a self-proclaimed geek, I can’t resist a bit of tech tinkering. After some consideration, my goals were:

1. Enable transparent proxy and bypass in Shanghai
2. Route some Shanghai traffic out via Hangzhou
3. Achieve mutual LAN access between Shanghai and Hangzhou

The reason for #2 is mostly to do with streaming services like Netflix: right now, traffic routes through a “node” (here’s where a referral link would go). That provider limits simultaneous devices and multiple logins from different regions might get the account banned. So, to play it safe, some traffic should be sent to Hangzhou first, then go out to the wider internet from there.

### Preparations

The network in Hangzhou is pretty simple: the fiber ONT connects to a soft router, which in turn connects to a TP-Link AP. There’s also a mini PC wired straight into the soft router, running a Shadowsocks server for daily “home-routing” traffic. The soft router is a BeiKong G30S (sponsored content goes here!), powered by an N5100—which is plenty. The OS is ImmortalWRT, with these plugins installed:

* AdguardHome: DNS-based ad blocking
* Nikki: Transparent proxy using the Mihomo core
* Tailscale: Creates a virtual LAN, mainly for ‘home-routing’
* DDNS-Go: Your standard Dynamic DNS service

LAN is on the 192.168.7.0/24 subnet.

To keep things consistent and cut down on trouble, I bought another G30S with the same specs for Shanghai, also running ImmortalWRT. The plan was to mirror Hangzhou’s topology: ONT - Soft Router - AP.

### Installation

One thing I have to mention about ImmortalWRT: I assumed installing it would be like Windows or other Linux distros, booting a live CD or installer from a USB stick. Well, guess what? You just *boot from the USB*—that’s it, the system runs straight from the image. 

So... the image is the OS itself!

I switched gears to using WinPE and used physdiskwrite to write the image to the hard drive. After a reboot, setup was a breeze—got the internet and DHCP up and running. The Shanghai LAN uses 192.168.10.0/24.

Next challenge: storage expansion. With OpenWRT written straight to the disk, only about 1GB of space was available—the rest just going to waste. Now came the second obstacle: I couldn’t find a clear expansion guide. Most Chinese-language tutorials are confusing, often wrong, and usually copy-pasted, focusing on squashfs or creating a whole new partition and switching the root. It’s hard to find a true “resize root partition” tutorial.

Eventually, I found the answer in the [official OpenWRT docs](https://openwrt.org/docs/guide-user/advanced/expand_root). Should’ve just searched in English—Google didn’t turn up anything useful in Chinese.

With that sorted, I moved on to handling proxying and setting the traffic exit—for which Clash works well.

[Nikki](https://github.com/nikkinikki-org/OpenWrt-nikki) is an OpenWRT plugin using the Mihomo core for transparent proxying. Compared to alternatives like Passwall or Clash, Nikki offers more customizability. One thing to note: install according to the instructions in the Readme; downloading the IPK from Releases and installing directly won’t work for some reason.

::github{repo="nikkinikki-org/OpenWrt-nikki"}

After importing my config, everything ran smoothly. Some key points:

1. You can enable tun mode directly, which auto-configures the router’s routing table for transparent proxy—works great out of the box.
2. For Mihomo’s domain-based splitting, DNS requests must be sent through Mihomo. You have two options: let Mihomo hijack port 53 and use dnsmasq on a different port, or configure dnsmasq to forward queries to Mihomo’s DNS port.
3. If using FakeIP mode, make sure to carefully set up the FakeIP filter.

Otherwise, the Mihomo experience is much the same as on any other platform.

Once Nikki is up and running, you’ll see in the dashboard that Mihomo is handling all the router’s outbound traffic.

My config files are almost straight copy-paste from before: most bypass traffic goes directly to my VPN provider; for rules requiring Shanghai traffic to go out via Hangzhou, the outbound is set to the Hangzhou Shadowsocks server. Tried it out—the latency isn’t bad! It’s like using a domestic relay.

At this stage, DNS-based routing allows Shanghai to access Hangzhou’s internal network. With FakeIP mode, Mihomo intercepts the fakeip responses, applies domain rules, and sends traffic to Hangzhou. But pure IP requests (not via DNS) can’t be forwarded by Mihomo (since tun doesn’t handle LAN traffic by default), and Hangzhou still can’t access Shanghai.

And that’s where Tailscale saves the day!

OpenWRT users can manage Tailscale with the [luci-app-tailscale](https://github.com/asvow/luci-app-tailscale) plugin. It offers a simple web interface for all Tailscale settings.

::github{repo="asvow/luci-app-tailscale"}

After installing, start Tailscale, complete device authentication, and—pro tip—disable key expiry for this device.

In the advanced settings:

* Check “enable routing”: Tailscale will set up routes to other subnets for you
* Do NOT check “enable DNS”: we only need to route IP traffic
* Subnet routes: put 192.168.10.0/24 to tell Tailscale this device can route this network
* Enable “allow subnet routing”: exactly what it sounds like
* Subnet selection: set to 192.168.7.0/24 for this side’s routing

Don’t forget: you need to repeat these routes on the Hangzhou side as well, making sure the correct subnets are set for each location.

After restarting Tailscale, subnet routing works: both Shanghai and Hangzhou can now access each other's subnet directly by IP.

### Afterword

The broadband in Shanghai uses some sort of “cloud broadband.” Disabling the cloud features and turning on bridge mode is an absurdly convoluted process (I *still* haven’t fully finished it).

So, all the above setup was done without a public IP on the Shanghai side.

Luckily, Hangzhou has a public IP, so Tailscale can punch through easily—the latency is only a few milliseconds. If neither side had a public IP, you’d have to either self-host a DERP relay or just accept hundreds of milliseconds of lag.

One final rant about Shanghai Telecom: enabling bridge mode requires signing agreements, taking photos, and passing reviews—like I’m trying to break into Fort Knox!