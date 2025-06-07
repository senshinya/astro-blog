---
title: 实现 OPNsense 透明代理+分流
tags: ["折腾","翻墙","透明代理","OPNsense","分流"]
lang: zh
published: 2025-01-16T23:09:00+08:00
description: "OPNsense 作为一款开源的防火墙和路由系统，因其美观的用户界面和全面的功能而备受关注。在经历了一系列路由方案后，用户们逐渐认识到其在透明代理和流量分流方面的强大潜力。通过结合 BGP 分流转发方式，OPNsense 提供了更高的安全性和稳定性，成为了理想的网络管理解决方案。尤其是其自动更新 IP 列表的功能，使得网络管理变得更加便捷。"
---
### 前言

早先透明代理 + 分流一直使用的是 ikuai 作为主路由，OpenWRT 作为旁路由的方案，这也是网上大部分教程的主流方案。后面冲浪的时候了解到 ikuai 可能会有 [偷跑流量与上报信息的情况](https://wusiyu.me/2022-ikuai-non-cloud-background-activities/) 出现，另外作为国产闭源系统，安全性也比较成问题

后续更换了主路由 OpenWRT，旁路由 Debian 的 [方案](/fiddling/debian-as-side-router)，后面又不使用旁路由方案，先后尝试了 [基于 FakeIP 的分流转发方案](/fiddling/fake-ip-based-transparent-proxy) 和 [基于 BGP 的分流转发方案](/fiddling/more-accurate-chnroute)，最终稳定在了基于 BGP 的分流转发方案上

最近又了解到了 OPNsense 这个防火墙/路由系统。简直是梦中情路由系统，开源免费，UI 美观，功能完善，同时还提供了 gui 界面支持自动更新 ip list 以用于分流。所以计划将现有的分流转发方案迁移到该系统上，同时不在单独使用一个软路由用于科学，而是直接将 clash 集成进主路由中

网上冲浪了下，相关的教程并不多，有部分教程也由于年久失修，不再有效。踩了一些坑后，决定整理一下详细的方案

梳理了下需要实现的功能：
- DNS 转发到 clash 统一解析
- 请求流量进入 OPNsense 后，可以根据某个 list 进行分流，将部分流量导入 clash

OPNsense 的基础安装过程就不再赘述，网络上相关的内容很多
### clash 安装

#### 二进制下载和配置文件

DNS 解析和流量处理都依赖了 clash 的功能，所以第一步先安装 clash

ssh 进 OPNsense（怎么开启 ssh？STFW）后，新建文件夹 `/usr/local/clash` 作为 clash 二进制、配置文件和其他相关文件的存放点。clash 二进制建议 scp 过去（毕竟主路由现在还没科学，直接下载速度很慢）。这里需要先把 clash 二进制和配置文件上传到该目录下。clash 二进制重命名为 clash，配置文件命名为 `config.yaml`

在 mihomo 的 [releases 页面](https://github.com/MetaCubeX/mihomo/releases) 下载最新的内核版本。注意下载 freebsd 版本，根据你的机器架构选择 386、amd64 或者 arm64。如果你是 amd64 且后续运行 clash 时阶段出现以下报错，请下载 `amd64-compatible` 版

```shell
This PROGRAM can only be run on _AMD64 processors with v3 microarchitecture_ support.
```

配置文件就不多说了，直接用一份你一直在用的就可以。但注意改动下面的配置

```yaml
mixed-port: 7890

dns:
  listen: 127.0.0.1:5353

tun:
  enable: false
```

dns 监听 5353 端口，作为 OPNsense 自带的 DNS 上游。同时关闭 tun，不主动劫持流量，而是由 OPNsense 进行流量筛选后导入。这里 mixed-port 同时兼具 socks-port、http-port 和 https-port 的功能

运行 `pw user add clash -c "Clash" -s /usr/sbin/nologin` 创建一个无登录的 clash 用户，并通过 `chown clash:clash /usr/local/clash` 赋予文件夹权限。完成后可以通过 `/usr/local/clash/clash -d /usr/local/clash` 执行一次，观察下是否可以成功运行

#### 注册 clash 服务

新建文件 `/usr/local/etc/rc.d/clash` 和 `/usr/local/opnsense/service/conf/actions.d/actions_clash.conf` 将 clash 注册成一个系统服务

```shell
#!/bin/sh
# $FreeBSD$

# PROVIDE: clash
# REQUIRE: LOGIN cleanvar
# KEYWORD: shutdown

# Add the following lines to /etc/rc.conf to enable clash:
# clash_enable (bool): Set to "NO" by default.
# Set to "YES" to enable clash.
# clash_config (path): Clash config dir.
# Defaults to "/usr/local/etc/clash"

. /etc/rc.subr

name="clash"
rcvar=clash_enable

load_rc_config $name

: ${clash_enable:="NO"}
: ${clash_config="/usr/local/clash"}

command="/usr/local/clash/clash"
#pidfile="/var/run/clash.pid"
required_files="${clash_config}"
clash_group="clash"
clash_user="clash"

command_args="-d $clash_config"

run_rc_command "$1"
```

```
[start]
command:/usr/local/etc/rc.d/clash onestart
type:script
message:starting clash

[stop]
command:/usr/local/etc/rc.d/clash stop
type:script
message:stoping clash

[status]
command:/usr/local/etc/rc.d/clash statusexit 0
type:script_output
message:get clash status

[restart]
command:/usr/local/etc/rc.d/clash onerestart
type:script
message:restarting clash
```

赋予运行权限 `chmod +x /usr/local/etc/rc.d/clash` 后启用 `service configd restart`

#### clash 开机自启

接下来设置 clash 开机自启就可以了，但这里有个坑：

> clash 作为系统服务启动后，并没有完成启动后就保持后台运行的功能，这样每次系统重启后会启动到 clash 之后就不会往后走，因该 clash 一直会保持在前台，导致排在 clash 后面的待启动服务就没法启动了

有一个曲折的办法就是通过 OPNsense 自带的一个服务监控功能 Monit 来拉起和监控 clash 的状态。Monit 功能可在 `服务-Monit` 中开启

在 Service Test Settings 中添加两个 Service Test，第一个负责拉起 clash

| Setting   | Value                                    |
| --------- | ---------------------------------------- |
| Name      | Clash                                    |
| Condition | failed host 127.0.0.1 port 7890 type tcp |
| Action    | Restart                                  |

第二个避免重启死循环

| Setting   | Value                      |
| --------- | -------------------------- |
| Name      | RestartLimit4              |
| Condition | 5 restarts within 5 cycles |
| Action    | Unmonitor                  |

最后在 Service Settings 里添加

| Setting | Value                                 |
| ------- | ------------------------------------- |
| Name    | Clash                                 |
| Match   | clash                                 |
| Start   | /usr/local/sbin/configctl clash start |
| Stop    | /usr/local/sbin/configctl clash stop  |
| Tests   | Clash,RestartLimit4                   |

保存后等待一段时间，在 Monit - Status 里查看 clash 是否正常运行

### DNS 解析

使用 OPNsense 自带的 Unbound DNS 设置上游 DNS 为 clash 的 127.0.0.1:5353，一直解析出错，非常奇怪

百思不得其解，最终决定关闭 Unbound DNS，用回了 AdGuard Home 作为默认 DNS，劫持 53 端口

AdGuard Home 没有被包含在 OPNsense 的默认插件源中，需要手动添加社区源

ssh 进 OPNsense 后执行命令

```shell
$ fetch -o /usr/local/etc/pkg/repos/mimugmail.conf https://www.routerperformance.net/mimugmail.conf
$ pkg update
```

接着在 web-gui 中的系统 - 固件 - 插件中搜索 adguard，安装 os-adguardhome-maxit 即可。安装完成后即可在服务-Adguardhome 中开启 Adguard Home。web 管理开放在 3000 端口，初始化设置过程不表，注意 DNS 监听端口设置为 53，即以 Adguard Home 作为 OPNsense 所在机器的默认 DNS server

安装完成后在 Adguard Home 的设置-DNS 设置中将上游 DNS 服务器设置为 127.0.0.1:5353，即 Clash 的 DNS 监听地址即可

### 国内外 IP 分流

#### 二进制下载和配置文件

OPNsense 默认是内置了一个 Squid 代理程序用于提供流量代理，但是该程序只能用于代理 http/https 流量，无法代理常规的 tcp 和 udp 流量，作为一个代理是很不完美的。于是采用了曲线救国的方案，通过 tun2socks 项目将 tcp/udp 流量导入 clash 完成代理

新建文件夹 `/usr/local/tun2socks` 作为 tun2socks 的二进制和配置文件的安放处。在 [Github Releases](https://github.com/xjasonlyu/tun2socks/releases) 中下载最新的 freebsd 二进制到文件夹下，并将其重命名为 tun2socks。新建配置文件 `/usr/local/tun2socks/config.yaml`

```yaml
# debug / info / warning / error / silent
loglevel: info

# URL format: [protocol://]host[:port]
proxy: socks5://127.0.0.1:7890

# URL format: [driver://]name
# TUN 设备名称，避免使用 tun0
device: tun://proxytun2socks0

# Maximum transmission unit for each packet
mtu: 1500

# Timeout for each UDP session, default value: 60 seconds
udp-timeout: 120s
```

`proxy` 处填写到 clash 的 socks5 端口的地址

可在文件夹 `/usr/local/tun2socks/` 内运行 `./tun2socks -config ./config.yaml`，测试配置文件是否正确

#### 注册服务

新建文件 `/usr/local/etc/rc.d/tun2socks` 和 `/usr/local/opnsense/service/conf/actions.d/actions_tun2socks.conf`

```shell
#!/bin/sh

# PROVIDE: tun2socks
# REQUIRE: LOGIN
# KEYWORD: shutdown

. /etc/rc.subr

name="tun2socks"
rcvar="tun2socks_enable"

load_rc_config $name

: ${tun2socks_enable:=no}
: ${tun2socks_config:="/usr/local/tun2socks/config.yaml"}

pidfile="/var/run/${name}.pid"
command="/usr/local/tun2socks/tun2socks"
command_args="-config ${tun2socks_config} > /dev/null 2>&1 & echo \$! > ${pidfile}"

start_cmd="${name}_start"

tun2socks_start()
{
    if [ ! -f ${tun2socks_config} ]; then
        echo "${tun2socks_config} not found."
        exit 1
    fi
    echo "Starting ${name}."
    /bin/sh -c "${command} ${command_args}"
}

run_rc_command "$1"
```

```
[start]
command:/usr/local/etc/rc.d/tun2socks start
parameters:
type:script
message:starting tun2socks

[stop]
command:/usr/local/etc/rc.d/tun2socks stop
parameters:
type:script
message:stopping tun2socks

[restart]
command:/usr/local/etc/rc.d/tun2socks restart
parameters:
type:script
message:restarting tun2socks

[status]
command:/usr/local/etc/rc.d/tun2socks status; exit 0
parameters:
type:script_output
message:request tun2socks status
```

创建 `/etc/rc.conf` 并添加以下内容：

```
tun2socks_enable="YES"
```

给予运行权限 `chmod +x /usr/local/etc/rc.d/tun2socks` 后启用 `service configd restart`

并手动启动 tun2socks

```shell
/usr/local/etc/rc.d/tun2socks start
```

#### 开机启动

创建文件 `/usr/local/etc/rc.syshook.d/early/60-tun2socks`

```bash
#!/bin/sh

# Start tun2socks service
/usr/local/etc/rc.d/tun2socks start
```

给予文件可执行权限 `chmod +x /usr/local/etc/rc.syshook.d/early/60-tun2socks` 即可

#### 新建端口、配置网关

在 OPNsense 的接口 - 分配中，添加一个新接口，设备即为我们在配置文件中写的 proxytun2socks0，保存即可

随后在添加的接口的配置页面启用接口，描述填写 TUN2SOCKS，IPv4 配置类型选择静态 IPv4，IPv4 地址为 `10.0.3.1/24`，保存

在系统 - 网关 - 配置中，新建一个网关，名称为 TUN2SOCKS_MIHOMO，接口选择我们刚添加的接口 TUN2SOCKS，IP 地址填写 `10.0.3.2`，其他默认保存

这样我们就新建了一个网关，只要流量进入这个网关，就会被转发到 127.0.0.1:7890，也就是 clash 进行代理
#### 设置国内外 IP 分流

OPNsense 对于我来说最有用的功能，就是防火墙 - 别名。这里可以设置一个 ip list，并在后续的规则配置中直接使用这个 ip list。这个 list 不仅可以手动填写，还可以直接订阅一个地址，动态获取

进入防火墙 - 别名，这里需要新建两个别名

第一个是 InternalAddress，表示局域网地址范围，类型选择 Network(s)，内容为

```
0.0.0.0/8
127.0.0.0/8
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.0.0/16
224.0.0.0/4
240.0.0.0/4
```

第二个是 CN_V4，表示国内的 IP 地址范围，类型选择 URL Table (IPs)，内容填写一个包含国内所有网段范围的列表地址即可，如 https://raw.githubusercontent.com/gaoyifan/china-operator-ip/refs/heads/ip-lists/china.txt

随后在防火墙 - 规则-LAN 中新建两个规则，排在规则列表的最前面，注意规则顺序从上到下

第一个规则目标为 InternalAddress，其余默认，表示目标地址为局域网时，按照默认规则路由

第二个规则目标为 CN_V4，并勾上目标/反转，网关选择上文新建的 TUN2SOCKS_MIHOMO，表示当目标地址为非中国 IP 时，将流量转发到 TUN2SOCKS_MIHOMO 网关

下面应该就是剩下的默认规则了，其他所有流量仍然按照默认规则路由，也就是国内 IP 直接走直连

当尝试访问 google 时，DNS 请求由 Adguard Home 获取转发到 clash，解析出 google 的真实地址。随后再向这个地址请求数据时，命中防火墙规则的第二条，转发到 TUN2SOCKS_MIHOMO 网关，通过 socks5 端口进入 clash 处理，最终实现出墙