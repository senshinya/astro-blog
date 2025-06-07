---
title: Implementing OPNsense Transparent Proxy + Traffic Routing
tags: ["fiddling", "circumvention", "transparent proxy", "OPNsense", "traffic routing"]
lang: en
published: 2025-01-16T23:09:00+08:00
abbrlink: fiddling/opnsense-transparent-proxy
description: "OPNsense, an open-source firewall and routing platform, has gained attention for its elegant UI and comprehensive features. After exploring various routing solutions, its powerful potential for transparent proxying and traffic segmentation became clear. Combining BGP-based routing, OPNsense offers enhanced security and stability, making it an ideal network management solution. Its automatic IP list updating functionality further simplifies network administration."
---
### Introduction

Previously, the transparent proxy plus traffic routing setup relied on iKuai as the main router and OpenWRT as a secondary router, which is also the mainstream approach in most online tutorials. However, during my browsing, I found that iKuai might have issues with [traffic leakage and information reporting](https://wusiyu.me/2022-ikuai-non-cloud-background-activities/). Moreover, as a proprietary closed-source domestic system, its security raised concerns.

Later, I switched the main router to OpenWRT and used Debian as the secondary router following a [dedicated scheme](/fiddling/debian-as-bypass-router). Eventually, I stopped using a separate secondary router and tried out both a [FakeIP-based traffic routing solution](/fiddling/fake-ip-based-transparent-proxy) and a [BGP-based traffic routing solution](/fiddling/more-accurate-chnroute), finally settling on the more stable BGP-based routing scheme.

Recently, I came across OPNsense, a firewall and routing system that’s practically the dream router: open-source, free, with an attractive UI and a rich feature set. Notably, it offers GUI support for automatic IP list updates used in routing. So I planned to migrate my current traffic routing setup to OPNsense, integrating Clash directly into the main router rather than using a separate soft router for circumvention.

After some online research, I found very few up-to-date tutorials, many of which are outdated and no longer effective. Having overcome a few pitfalls, I decided to document the detailed solution here.

Here’s an outline of the functionalities I aimed to implement:
- Forward DNS requests to Clash for unified resolution.
- Once traffic reaches OPNsense, perform routing based on a specified IP list, directing certain traffic through Clash.

The basic installation of OPNsense isn’t covered here as plenty of resources are available online.

### Installing Clash

#### Binary Download and Configuration

Since both DNS resolution and traffic processing depend on Clash’s capabilities, the first step is to install Clash.

SSH into OPNsense (look up how to enable SSH, STFW), then create a new directory `/usr/local/clash` to store the Clash binary, configuration files, and other related files. It’s recommended to SCP the Clash binary over (since the main router isn’t set up for circumvention yet, direct downloading is very slow). Upload both the Clash binary and the configuration file to this directory. Rename the Clash binary simply to `clash`, and the configuration file to `config.yaml`.

Download the latest Clash core from Mihomo’s [releases page](https://github.com/MetaCubeX/mihomo/releases). Make sure to pick the FreeBSD version that matches your machine’s architecture: 386, amd64, or arm64. If you’re on amd64 and encounter the following error during runtime, download the `amd64-compatible` version instead:

```shell
This PROGRAM can only be run on _AMD64 processors with v3 microarchitecture_ support.
```

I won’t elaborate much about the config file — just use the one you already have. But pay attention to these settings:

```yaml
mixed-port: 7890

dns:
  listen: 127.0.0.1:5353

tun:
  enable: false
```

Here, DNS listens on port 5353 to act as OPNsense’s upstream DNS. The TUN mode is disabled because we won’t intercept traffic actively; instead, OPNsense will filter traffic and forward accordingly. The `mixed-port` serves as SOCKS, HTTP, and HTTPS ports all in one.

Run `pw user add clash -c "Clash" -s /usr/sbin/nologin` to create a clash user without login privileges, then change ownership of the folder via `chown clash:clash /usr/local/clash`. Afterward, execute `/usr/local/clash/clash -d /usr/local/clash` once to verify it runs successfully.

#### Registering Clash as a Service

Create the files `/usr/local/etc/rc.d/clash` and `/usr/local/opnsense/service/conf/actions.d/actions_clash.conf` to register Clash as a system service.

`/usr/local/etc/rc.d/clash` content:

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

`/usr/local/opnsense/service/conf/actions.d/actions_clash.conf` content:

```
[start]
command:/usr/local/etc/rc.d/clash onestart
type:script
message:starting clash

[stop]
command:/usr/local/etc/rc.d/clash stop
type:script
message:stopping clash

[status]
command:/usr/local/etc/rc.d/clash statusexit 0
type:script_output
message:get clash status

[restart]
command:/usr/local/etc/rc.d/clash onerestart
type:script
message:restarting clash
```

Make the service script executable with `chmod +x /usr/local/etc/rc.d/clash`, then restart configuration service by running `service configd restart`.

#### Enabling Clash Autostart at Boot

Next, enable Clash to start automatically at boot — but here’s a gotcha:

> When Clash starts as a system service, it does not daemonize by default. This means after system reboot, Clash starts but stays in the foreground, blocking subsequent services from starting.

To work around this, we use OPNsense’s built-in service monitor, Monit, to keep Clash running and restart it if it crashes. Enable Monit in the OPNsense GUI under **Services → Monit**.

In the Service Test Settings, add two service tests. The first is for starting Clash:

| Setting   | Value                                    |
| --------- | ---------------------------------------- |
| Name      | Clash                                    |
| Condition | failed host 127.0.0.1 port 7890 type tcp |
| Action    | Restart                                  |

The second service test prevents restart loops:

| Setting   | Value                      |
| --------- | -------------------------- |
| Name      | RestartLimit4              |
| Condition | 5 restarts within 5 cycles |
| Action    | Unmonitor                  |

Then in **Service Settings**, add:

| Setting | Value                                 |
| ------- | ------------------------------------- |
| Name    | Clash                                 |
| Match   | clash                                 |
| Start   | /usr/local/sbin/configctl clash start |
| Stop    | /usr/local/sbin/configctl clash stop  |
| Tests   | Clash,RestartLimit4                   |

Save, wait a while, then check Clash’s status under **Monit → Status** to ensure it is running properly.

### DNS Resolution

I tried setting OPNsense’s built-in Unbound DNS upstream to Clash’s 127.0.0.1:5353 but it repeatedly failed, which was puzzling.

After much frustration, I disabled Unbound DNS and switched back to using AdGuard Home as the default DNS server, hijacking port 53.

AdGuard Home isn’t included in OPNsense’s default plugin repository, so you need to manually add a community repo.

SSH into OPNsense and run:

```shell
fetch -o /usr/local/etc/pkg/repos/mimugmail.conf https://www.routerperformance.net/mimugmail.conf
pkg update
```

Then, in the web GUI under **System → Firmware → Plugins**, search for `adguard` and install `os-adguardhome-maxit`. Once installed, start AdGuard Home under **Services → AdGuardHome**. The web management UI listens on port 3000; initial setup is straightforward. Be sure to set the DNS listening port to 53 so AdGuard Home acts as OPNsense’s default DNS server.

Finally, inside AdGuard Home’s DNS settings, set upstream DNS servers to `127.0.0.1:5353` (i.e., Clash's DNS listener).

### Domestic vs. International IP Traffic Routing

#### Binary Download and Configuration

OPNsense includes a Squid proxy by default, but it only handles HTTP/HTTPS traffic and cannot proxy traditional TCP/UDP streams—making it an incomplete proxy solution. To work around this, I used `tun2socks` to route TCP/UDP traffic to Clash and fully proxy all streams.

Create `/usr/local/tun2socks` to store the tun2socks binary and configuration file. Download the latest FreeBSD binary from the [tun2socks GitHub Releases](https://github.com/xjasonlyu/tun2socks/releases) and rename it to `tun2socks`. Create a config file `/usr/local/tun2socks/config.yaml` with the following:

```yaml
# debug / info / warning / error / silent
loglevel: info

# URL format: [protocol://]host[:port]
proxy: socks5://127.0.0.1:7890

# URL format: [driver://]name
# TUN device name; avoid tun0
device: tun://proxytun2socks0

# Maximum transmission unit per packet
mtu: 1500

# UDP session timeout, default 60s
udp-timeout: 120s
```

Set the `proxy` field to point to Clash’s SOCKS5 port.

You can test this with:

```bash
cd /usr/local/tun2socks/
./tun2socks -config ./config.yaml
```

#### Registering tun2socks as a Service

Create `/usr/local/etc/rc.d/tun2socks` and `/usr/local/opnsense/service/conf/actions.d/actions_tun2socks.conf`.

`/usr/local/etc/rc.d/tun2socks`:

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

`/usr/local/opnsense/service/conf/actions.d/actions_tun2socks.conf`:

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

Edit `/etc/rc.conf` and add:

```
tun2socks_enable="YES"
```

Make the script executable with `chmod +x /usr/local/etc/rc.d/tun2socks` and restart config daemon:

```shell
service configd restart
```

Start tun2socks manually for now:

```shell
/usr/local/etc/rc.d/tun2socks start
```

#### Enabling tun2socks at Boot

Create `/usr/local/etc/rc.syshook.d/early/60-tun2socks` with:

```bash
#!/bin/sh

# Start tun2socks service
/usr/local/etc/rc.d/tun2socks start
```

Make it executable:

```shell
chmod +x /usr/local/etc/rc.syshook.d/early/60-tun2socks
```

#### Create Interface and Configure Gateway

In OPNsense’s **Interfaces → Assignments**, add a new interface selecting the device `proxytun2socks0` defined in the config file. Save.

Go to the new interface’s configuration page, enable the interface, set the description to `TUN2SOCKS`, choose IPv4 Configuration Type as **Static IPv4**, and set the IPv4 address to `10.0.3.1/24`. Save.

Then, in **System → Gateways → Configuration**, create a new gateway:

- Name: `TUN2SOCKS_MIHOMO`
- Interface: `TUN2SOCKS` (the one just created)
- Gateway Address: `10.0.3.2`
- Leave other settings at defaults, save.

Now you have a gateway where any traffic routed to it will be forwarded to `127.0.0.1:7890` (Clash) for proxying.

#### Setting up Domestic and International IP Routing

One of OPNsense’s most valuable features is the firewall aliases, which let you define IP lists and apply them in firewall rules dynamically. You can input these lists manually or subscribe to online sources for automatic updates.

Navigate to **Firewall → Aliases**, create two new aliases.

The first alias, `InternalAddress`, defines local network IP ranges. Choose type: **Network(s)**. Enter:

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

The second alias, `CN_V4`, represents Chinese IP ranges. Choose type: **URL Table (IPs)** and supply a subscription URL that contains the full list of domestic IP ranges, for example:  

```
https://raw.githubusercontent.com/gaoyifan/china-operator-ip/refs/heads/ip-lists/china.txt
```

Next, under **Firewall → Rules → LAN**, add two rules placed at the very top—remember, rules are processed top-down.

- The first rule’s destination is `InternalAddress`, with default settings, allowing default routing for LAN destinations.
  
- The second rule’s destination is `CN_V4`, but check **Invert destination** and select gateway `TUN2SOCKS_MIHOMO`. This means traffic targeting non-China IPs will be forwarded via the `TUN2SOCKS_MIHOMO` gateway, i.e., routed to Clash.

Leave the remaining default rules as is; all other traffic (mostly domestic IPs) will route directly to the internet without proxy.

Now, when trying to access Google, DNS requests are handled by AdGuard Home and forwarded to Clash, which resolves Google’s real IPs. Upon connecting to those IPs, the second firewall rule triggers, forwarding traffic to the `TUN2SOCKS_MIHOMO` gateway. This routes packets through Socks5 on port 7890 to Clash, successfully enabling bypassing restrictions.