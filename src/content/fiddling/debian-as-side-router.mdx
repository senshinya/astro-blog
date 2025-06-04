---
title: debian 旁路由方案
tags: ["折腾","debian","旁路由","翻墙","透明代理","mihomo"]
published: 2024-07-13T17:49:00+08:00
description: "介绍一种基于Debian的旁路由方案，解决OpenWRT和LuCI的稳定性问题。"
---
### 前言

大部分旁路由方案都是基于 OpenWRT 搭建 —— 这是一个单独的 Linux 发行版，拥有自己的软件包系统。再其中大部分方案又是基于 LuCI —— 专用于 OpenWRT 的 Web GUI，教程中使用的软件也是 luci-app-xxx，专为 LuCI 打造。这些方案很好，但不够好：

1. 过于依赖 GUI 配置: LuCI 的软件包通常在 web 端只能进行有限的配置
2. LuCI 不够稳定: 不是 OpenWRT 不稳定，而是 LuCI 不稳定。我的 LuCI 曾因为 OpenClash 崩溃过三次（也可能是我的问题）
3. 尽管我们可以自编译 OpenWRT，但是大部分教程都直接使用了一些预编译好的固件，有些可能会过时
4. 无法完全掌控系统（被 LuCI 架空啦

我也曾经折腾过一两年的 OpenWRT 透明代理方案，主路由方案旁路由方案，最终都因为其不够稳定而放弃。很长一段时间都直接使用各种客户端（Surge、loon、clash verge rev 等）勉强用着。大概一周前，绝区零上线。由于国服版号问题，PS5 仅上线了国际服。即使选择亚服，勉强可以直连，网速和延迟也让人绝望。本着不给网易 UU 送钱的态度，我又想起了透明代理。正好，我手头有一台闲置的零刻小主机。预先装好了 Debian，本来打算用来做开发机来着，结果因为我太懒，也一直吃灰。于是折腾了一个周末，最终完成了使用 Debian 作为旁路由进行透明代理的方案。

最终形态的网络拓扑如下：

![topo](https://blog-img.shinya.click/2025/c4347103c787f3d28b50a679e80aa0fe.png)

可以看到，整个内网被划分成了两个网段：192.168.6.0/24，192.168.7.0/24。其中 6.0/24 为默认网段，用于无需越墙的设备，而 7.0/24 为需要越墙的设备，其流量都会经过旁路由小主机转发。

主要方案为 AdguardHome + Clash，其中 AdguardHome 用于广告过滤等功能，Clash 用于 DNS 分流和流量代理。

### 主路由配置

在配置之前，内网 IP 段为 192.168.6.0/24，我们需要新开一个网段 192.168.7.0/24

我的主路由是 iKuai，下面是 iKuai 新开网段的方法，OpenWRT 或者其他路由系统可以自行 Google

iKuai 下网络设置 - 内外网设置 - lan1，高级设置中添加一个扩展 IP，IP 为 192.168.7.1，子网掩码 255.255.255.0

![iKuai 配置](https://blog-img.shinya.click/2025/9fc87b145274f1fb0cba1ed0d2329ac0.png)

DHCP 设置中添加一个 192.168.7.0/24 网段的 DHCP 配置

![DHCP 配置](https://blog-img.shinya.click/2025/2de91498b256d08c92a3c8844ca14dbe.png)

网关设置为 192.168.7.2，即后面要配置的旁路由的地址，首选 DNS 和备选 DNS 也都设置为 192.168.7.2，因为该网段下的 DNS 都由旁路由处理。

### Debian 配置

以下操作如果不做说明，都是在旁路由机器上进行。

#### 配置 IP

编辑 Debian 的网络配置：输入 `sudo nano /etc/network/interfaces`，编辑为以下内容，并保存退出：

```
# This file describes the network interfaces available on your system
# and how to activate them. For more information, see interfaces(5).

source /etc/network/interfaces.d/*

# The loopback network interface
auto lo
iface lo inet loopback

# The primary network interface
allow-hotplug enp1s0
iface enp1s0 inet static
address 192.168.7.2
netmask 255.255.255.0
gateway 192.168.7.1
dns-nameservers 127.0.0.1
```

该配置中：
- `enp1s0` 是我的网卡设备名，请将其改为你自己的设备名，可以通过 `ip a` 查看
- IPV4 网络进行静态配置 `inet static`，并固定设备 IP 为 `192.168.7.2/24`，网关指向主路由 `192.168.7.1`，DNS 在配置完成前可以先设置为可用的 DNS Server，等待本机上的 AdguardHome 配置完成后再改为 `127.0.0.1`，以防在配置过程中无法上网

保存配置后可以通过如下命令重启网络

```shell
sudo systemctl restart networking.service
```

注意这个时候 SSH 连接可能会断开，因为设备 IP 已经改变了。应当通过新的 IP `192.168.7.2` 重新 SSH 登陆。

`ip a` 查看配置结果：

```shell
ip a
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
    inet6 ::1/128 scope host noprefixroute
       valid_lft forever preferred_lft forever
2: enp1s0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
    link/ether 70:70:fc:00:e3:36 brd ff:ff:ff:ff:ff:ff
    inet 192.168.7.2/24 brd 192.168.7.255 scope global enp1s0
       valid_lft forever preferred_lft forever
    inet6 ■■■:■■■■:■■■■:■■■:■■■■:■■■■/64 scope global dynamic mngtmpaddr
       valid_lft 1741sec preferred_lft 1741sec
    inet6 fe80::7270:fcff:fe00:e336/64 scope link
       valid_lft forever preferred_lft forever
```

可以看到本机的内网 IP 已经变成了 192.168.7.2/24

#### 配置转发

只有拥有流量转发功能的机器才可以作为路由和网关：

```shell
sudo echo "net.ipv4.ip_forward = 1" >> /etc/sysctl.conf
sudo sysctl -p
```

### AdguardHome 配置

以下说明下 DNS 思路

![DNS 链路](https://blog-img.shinya.click/2025/bb62d86943fdce26364eea909c4621a9.png)

当客户端需要解析 DNS 时，监听在 53 端口上的 AdguardHome 会转发给其上游 Clash，然后 Clash 根据设置来进行分流，中国大陆部分使用国内的公共 DNS 服务器进行解析，非中国大陆部分通过代理向国外公共 DNS 服务器进行解析

而当 Clash 出现异常时，AdguardHome 则直接向国内公共 DNS 服务器请求解析（实际上意义不大，即使解析出来的 IP，流量还是要通过 Clash）

#### 安装 AdguardHome

以下命令以 root 身份运行

```shell
## 检查最新稳定版的版本号，如果获取不到请检查网络
remote_ver=$(curl -sS https://api.github.com/repos/AdguardTeam/AdGuardHome/releases/latest | jq -r .tag_name | sed 's|v||' | grep -v "null"); echo $remote_ver

## 下载最新稳定版（前一句有输出这一句才能正常执行）
cd /tmp
wget -q --progress=bar:dot --show-progress -O "AdGuardHome_linux_amd64.tar.gz" "https://github.com/AdguardTeam/AdGuardHome/releases/download/v${remote_ver}/AdGuardHome_linux_amd64.tar.gz"

## 解压
tar --no-same-owner -xf "AdGuardHome_linux_amd64.tar.gz" --strip-components 2 --directory=.

## 安装
install -ps AdGuardHome /usr/local/bin/adguardhome
```

#### 创建服务

创建工作目录 `/var/lib/adguardhome`

```shell
mkdir -p /var/lib/adguardhome
```

创建 `/etc/systemd/system/adguardhome.service` 如下，这时配置文件为 `/var/lib/adguardhome/AdGuardHome.yaml`

```ini
[Unit]
Description = Network-wide ads & trackers blocking DNS server.
Wants       = network-online.target mosdns.service
After       = network-online.target mosdns.service

[Service]
Type               = simple
Restart            = always
StartLimitInterval = 5
StartLimitBurst    = 10
ExecStart          = /usr/local/bin/adguardhome -w /var/lib/adguardhome
RestartSec         = 10

[Install]
WantedBy = multi-user.target
```

保存后通过 `systemctl enable --now adguardhome.service` 设置开机启动并立刻启动。后续如想查看日志，我们直接使用 Debian 自带的工具来查看：

```shell
journalctl -efu adguardhome.service
```

如果想要重启：

```shell
systemctl restart adguardhome.service
```

#### 初始化配置

打开 `http://192.168.7.2:3000` 进行初始化配置，网络管理界面端口可以保持 3000，DNS 服务器端口设置为 53

设置 - DNS 设置中，上游 DNS 设置为我们暂未配置的 Clash DNS `127.0.0.1:1053`，后备 DNS 服务器可以填写几个国内的 DNS，如

```
223.5.5.5
119.29.29.29
```

记得点击应用

随后 DNS 服务配置-速度限制 设置为 0 即可。

如果需要去广告的话，可以在 过滤器 - DNS 黑名单 中添加，这里推荐两个大陆使用效果较好的规则集：

```
easylist:  https://anti-ad.net/easylist.txt
half-life: https://adguard.yojigen.tech/HalfLifeList.txt
```

### Clash 配置

Clash 在整个方案中负责国内外 DNS 解析分流，另外就是老本行穿墙了。由于 Clash 原仓库已删库跑路，衣钵由 mihomo 集成（米哈游你坏事做尽）

#### 安装 Clash

以下命令以 root 身份运行：

```shell
## 检查最新稳定版的版本号，如果获取不到请检查网络
remote_ver=$(curl -sS https://api.github.com/repos/MetaCubeX/mihomo/releases/latest | jq -r .tag_name | sed 's|v||' | grep -v "null"); echo $remote_ver

## 下载最新稳定版（前一句有输出这一句才能正常执行）
cd /tmp
wget -q --progress=bar:dot --show-progress -O "mihomo-linux-amd64-v${remote_ver}.gz" "https://github.com/MetaCubeX/mihomo/releases/download/v${remote_ver}/mihomo-linux-amd64-v${remote_ver}.gz"

## 解压
gzip -d "mihomo-linux-amd64-v${remote_ver}.gz"

## 安装
install -ps mihomo-linux-amd64-v${remote_ver} /usr/local/bin/clash
```

#### 创建服务

创建工作目录 `/var/lib/clash`

```shell
mkdir -p /var/lib/clash
```

创建用户 clash

```shell
useradd -M -s /usr/sbin/nologin clash
```

创建文件 `/etc/systemd/system/clash.service`，内容如下。这时 clash 的配置文件为 `/var/lib/clash/config.yaml`。

```ini
[Unit]
Description = Clash-Meta tproxy daemon.
Wants       = network-online.target
After       = network-online.target

[Service]
Environment   = PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/b>
Type          = simple
User          = clash
Group         = clash

CapabilityBoundingSet = CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW
AmbientCapabilities   = CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW

Restart       = always
ExecStartPre  = +/usr/bin/bash /var/lib/clash/clean.sh
ExecStart     = clash -d /var/lib/clash
ExecStartPost = +/usr/bin/bash /var/lib/clash/iptables.sh

ExecStopPost  = +/usr/bin/bash /var/lib/clash/clean.sh
```

可以从这个文件中看到，clash 二进制文件是以 clash:clash 用户身份运行的，这是为了方便区分 clash 自身程序发出来的流量，和 clash 转发的流量。

注意到 ExecStartPost 和 ExecStopPost 阶段我们执行了两个文件 iptables.sh 和 clean.sh，用来设置和清空路由表。

iptables.sh 和 clean.sh 内容如下：

```sh
#!/usr/bin/env bash

set -ex

# ENABLE ipv4 forward
sysctl -w net.ipv4.ip_forward=1

# ROUTE RULES
ip rule add fwmark 666 lookup 666
ip route add local 0.0.0.0/0 dev lo table 666

# clash 链负责处理转发流量
iptables -t mangle -N clash

# 目标地址为局域网或保留地址的流量跳过处理
# 保留地址参考: https://zh.wikipedia.org/wiki/%E5%B7%B2%E5%88%86%E9%85%8D%E7%9A%84/8_IPv4%E5%9C%B0%E5%9D%80%E5%9D%97%E5%88%97%E8%A1%A8
iptables -t mangle -A clash -d 0.0.0.0/8 -j RETURN
iptables -t mangle -A clash -d 127.0.0.0/8 -j RETURN
iptables -t mangle -A clash -d 10.0.0.0/8 -j RETURN
iptables -t mangle -A clash -d 172.16.0.0/12 -j RETURN
iptables -t mangle -A clash -d 192.168.0.0/16 -j RETURN
iptables -t mangle -A clash -d 169.254.0.0/16 -j RETURN

iptables -t mangle -A clash -d 224.0.0.0/4 -j RETURN
iptables -t mangle -A clash -d 240.0.0.0/4 -j RETURN

# 其他所有流量转向到 7893 端口，并打上 mark
iptables -t mangle -A clash -p tcp -j TPROXY --on-port 7893 --tproxy-mark 666
iptables -t mangle -A clash -p udp -j TPROXY --on-port 7893 --tproxy-mark 666

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

# 跳过 clash 程序本身发出的流量, 防止死循环(clash 程序需要使用 "clash" 用户启动)
iptables -t mangle -A OUTPUT -p tcp -m owner --uid-owner clash -j RETURN
iptables -t mangle -A OUTPUT -p udp -m owner --uid-owner clash -j RETURN

# 让本机发出的流量跳转到 clash_local
# clash_local 链会为本机流量打 mark, 打过 mark 的流量会重新回到 PREROUTING 上
iptables -t mangle -A OUTPUT -j clash_local

# 修复 ICMP(ping)
# 这并不能保证 ping 结果有效(clash 等不支持转发 ICMP), 只是让它有返回结果而已
# --to-destination 设置为一个可达的地址即可
sysctl -w net.ipv4.conf.all.route_localnet=1
iptables -t nat -A PREROUTING -p icmp -d 198.18.0.0/16 -j DNAT --to-destination 127.0.0.1
```

```sh
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

每行都有详细的注释，再细节可以去问 ChatGPT

#### clash 配置文件

clash 配置文件可以从各订阅商处获得，格式应当是 yaml。将其保存到 `/var/lib/clash/config.yaml`，并将其按照如下模块更改：

```yaml
tproxy-port: 7893   # iptables.sh 将所有流量转发到了 7893 端口
mixed-port: 7890
allow-lan: true
find-process-mode: off
bind-address: "*"
mode: rule
log-level: debug
ipv6: false # 不进行IPv6流量代理

external-controller: 0.0.0.0:9090
secret: # 登陆ui的密码
external-ui: ui # webui的基础路径
external-ui-name: xd # webui的下级路径
external-ui-url: https://github.com/MetaCubeX/metacubexd/archive/refs/heads/gh-pages.zip
unified-delay: true
tcp-concurrent: true
experimental:
  sniff-tls-sni: true
geodata-mode: true
geodata-loader: standard
geox-url:
  geoip: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat
  geosite: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat
  mmdb: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/country.mmdb
profile:
  tracing: true
  store-selected: true
  store-fake-ip: true
sniffer:
  enable: true
  parse-pure-ip: true
  override-destination: true

dns:
  enable: true
  ipv6: false
  listen: 0.0.0.0:1053 # DNS监听端口
  use-hosts: true
  enhanced-mode: fake-ip
  default-nameserver: # 建议修改为国内DNS服务器
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - https://doh.pub/dns-query
    - tls://dot.pub
    - tls://dns.alidns.com
    - https://dns.alidns.com/dns-query
  fallback:
    - https://dns.cloudflare.com/dns-query
    - tls://dns.google:853
    - https://1.1.1.1/dns-query
    - tls://1.1.1.1:853
    - tls://8.8.8.8:853
  fake-ip-filter:
    - '+.lan'
    - '+.cluster.local'
    - 'time.*.com'
    - 'time.*.gov'
    - 'time.*.edu.cn'
    - 'time.*.apple.com'
    - 'ntp.*.com'
    - 'localhost.ptlogin2.qq.com'
    - '+.ntp.org.cn'
    - '+.pool.ntp.org'
    - '+.localhost'
  fallback-filter:
    geoip: true
    geoip-code: CN
    geosite:
      - gfw
    ipcidr:
      - 224.0.0.0/4
      - 240.0.0.0/4
      - 169.254.0.0/16
      - 0.0.0.0/8
      - 127.0.0.1/32
    domain:
      - '+.google.com'
      - '+.facebook.com'
      - '+.youtube.com'

proxies:  # 以下为你的代理节点、分组及代理规则
proxy-groups:
rules:
```

这里着重说一下 dns 部分，dns 分成了两个 dns server 组：
- nameserver 部分为国内的公共 DNS
- fallback 部分为国外的公共 DNS

fallback-filter 控制了当域名满足什么条件时，使用 fallback 组的 DNS 解析结果
- geoip-code 为反向条件，即通过 nameserver 解析出的 IP 未命中 geoip-code 则会使用 fallback 的解析结果
- geosite 为正向条件，匹配 geosite 中的域名会使用 fallback
- ipcidr 为正向条件，nameserver 解析出这些结果时（即污染 IP）则会使用 fallback 的解析结果
- domain 为正向条件，匹配到这些域名则会直接使用 fallback

由此即完成了 DNS 解析的分流。

#### clash 的其他相关文件

clash 还需要一些配套文件，在启动前需要先下载下来

```shell
cd /var/lib/clash
wget -q --progress=bar:dot --show-progress -O country.mmdb https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb
wget -q --progress=bar:dot --show-progress -O geosite.dat  https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat
wget -q --progress=bar:dot --show-progress -O GeoIP.dat    https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat

mkdir -p ui
cd ui
wget -q --progress=bar:dot --show-progress -O xd.zip https://github.com/MetaCubeX/metacubexd/archive/refs/heads/gh-pages.zip
unzip -oqq xd.zip
mv metacubexd-gh-pages xd
```

最终 `/var/lib/clash` 目录下应当是这样的

```shell
/var/lib/clash
├── clean.sh
├── config.yaml
├── country.mmdb
├── GeoIP.dat
├── geosite.dat
├── iptables.sh
└── ui
```

由于 clash 程序以 clash 用户身份启动，所以需要更改下所有权：

```shell
chown -R clash:clash /var/lib/clash
```

并设置 iptables.sh 和 clean.sh 可执行

```shell
chmod +x iptables.sh
chmod +x clean.sh
```

#### 服务启动

完全配置好以后，我们可以设置 `/etc/systemd/system/clash.service` 为开启自动启动，并立即启动起来。

```shell
systemctl enable --now clash.service
```

后续如想查看日志，我们直接使用 Debian 自带的工具来查看：

```shell
journalctl -efu clash.service
```

访问 webui：`http://192.168.7.2:9090/ui/xd`

webui 的配置大家就很熟悉了。如果配置完成没啥问题，就可以将本机的 dns 改为 127.0.0.1 了（上文提到），并将内网设备的网关和 DNS 都指向 192.168.7.2

### 端口映射

如果你在主路由上配置了端口映射，且被映射端口的机器网关配置的是旁路由，那此时端口映射应当是失效了。可以在[旁路由端口映射失效解决](/fiddling/fix-port-forward-in-side-router)这篇文章中找到解决方案。