---
title: One Month Using Android – A Migration Tale
lang: en
published: 2025-06-05T23:26:00.000+08:00
tags: ["fiddling","Android","Oppo","Apple","Mobile Phone"]
abbrlink: one-month-using-android
description: "As someone who changes phones frequently, I’ve made the switch from OnePlus to iPhone, gradually shifting from the joy of tinkering to a reliance on ecosystems. Recently, at the suggestion of my partner, I picked up an Oppo Find X8 Ultra, mainly to upgrade my photography game. Although deeply ingrained in the Apple ecosystem, migrating apps made me realize the Android app landscape is still hit-or-miss and searching for alternatives can be a challenge. After a month, the friction and adaptation between platforms has been palpable."
---
### Introduction

I’m someone who changes phones frequently. Especially after starting work and saving up a bit, I developed a bit of a “shiny new toy” problem—hardly any phone stays with me for more than a year. As soon as a new device launches, I start thinking about how I’d use it as my daily driver, how to migrate my apps and workflows, and before I know it, my hand is reaching for the “buy” button. The old phone either goes to family, gets sold second-hand, or ends up as a backup—usually to be forgotten in the drawer.

Just listing my primary devices from the past four years: OnePlus 8T, OnePlus 9 Pro, Pixel 5, Oppo Find X6 Pro, Vivo X Fold3 Pro, iPhone 14 Pro, iPhone 16 Pro—and a OnePlus 7Pro still hanging around as a spare.

You can trace my mindset changes just by looking at this lineup. Early on, with OnePlus/Pixels, I loved tinkering and open systems: rooting, unlocking bootloaders, making things as free and flexible as possible. Then, with Oppo and Vivo, the urge to fiddle faded but I still clung to some of that spirit, especially with the foldable from Vivo. But then came the iPhone era, where I fully bought into the Apple ecosystem and its seamless integration.

Just as I was thoroughly enmeshed in Apple’s walled garden, my partner hit me with a blunt observation: “Your photos are trash.” Fair point—in my early days, I only cared about benchmarks and spec sheets, cameras were just for QR codes. But now I wanted to prove:

> Any lack of skill can surely be compensated for with superior hardware and software!

Of course, this was yet another excuse to switch phones. Honestly, during my last [Kansai trip](/travels/kansai-202504), my friend’s camera left a deep impression, especially that long zoom. But I’m naturally lazy and don’t like post-editing, so I figured why not get a phone that at least has solid lenses and color science to satisfy my impulsive shutter finger.

This year, all three major Chinese brands released their “Ultra” flagships—Vivo X200 Ultra, Oppo Find X8 Ultra, Xiaomi 15 Ultra. I immediately ruled out Xiaomi ([<del>Lei Jun! Jin Fan!</del>]), and while Vivo’s long zoom is a concert monster, I never seem able to get concert tickets anyway. In the end, I went with Oppo Find X8 Ultra, which has a 1-inch sensor on its main camera. After a month of use, the hardest part has been migrating away from the Apple ecosystem—especially since many apps are iOS-only and the Android app landscape is inconsistent, finding replacements took a lot of work. With the bootloader locked down, rooting is out of the question, so I just have to accept certain compromises.

### Ads, Ads Everywhere

The biggest headache with domestic Android manufacturers is the omnipresence of ads. My first order of business: ad removal.

<iframe src="//player.bilibili.com/player.html?isOutside=true&aid=113746622021969&bvid=BV18c6JYLEmw&cid=27626637570&p=1&autoplay=0" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>

After my tweaks, only the recommendation ads at the bottom of the weather app’s subpages remained, tough to weed out—like digital eczema.

### Photo Backups

Being deep in Apple’s ecosystem, all my photos lived in iCloud; I even upgraded to the 200GB plan just for photos. At the moment I’m using about 50GB, covering everything since undergrad. Recently I also switched my NAS to Feiniu OS and double-backed up my album there.

Now, with Android, I certainly had no plans to use the brand’s own cloud (looking at you, Huantai Cloud). Migrating back to Google Photos would be a pain after previously spending ages moving everything from Google Photos to iCloud. Besides, Google Photos only offers 15GB free, and even though I managed to get 2TB Google AI Pro using my alumni email, it just doesn’t feel solid.

Because my other devices are still Apple, I decided to keep storing photos in iCloud. I installed “O+ Connect” on my Mac—every time I boot up, it connects automatically, but I still have to manually export and import photos into Apple Photos. Honestly, the O+ Connect experience is worse than the Vivo office suite: more bugs, fewer features—clipboard sync doesn’t work, you can’t control the phone from your Mac, no automatic photo sync. Oppo support seems to have given up on it; updates are rare. I’m just muddling through.

### Proxy/“Home” Network Access

Both my phone and laptop have proxy apps installed, mainly to “go home” (access my home network) for two reasons:
1. To reach home-hosted services like my albums and notes
2. My home setup includes DNS ad blocking and rule-based transparent proxies, so as long as I connect home, I don’t need to fuss with complex rules—I just get the same network experience as being at home

On iPhone, I kept Surge running in the background 24/7 as a global home proxy. But if I stayed connected on my home WiFi, the global routing would kill my connectivity unless managed. Surge’s “Subnet Override” feature was a lifesaver: it can perform actions like SUSPEND proxying based on the current WiFi SSID, perfectly solving the home/away switching problem and keeping the proxy running seamlessly in the background.

Switching to Android, I was faced with too many options—unlike iOS, where most proxies are proprietary, Android apps are often UIs wrapped around open-source core engines like mihomo (clash), v2ray, xray, or the newer singbox. Nearly every client requires you to upload or subscribe to config files rather than tweak rules in the UI—which isn’t a big deal for me, since my setup is mostly static. The bigger hassle was finding a client that supported SSID-based rules like Surge’s subnet override; I did not want to be toggling proxies manually every time I left the house.

Eventually I found SurfBoard, a lesser-known app that supports SSID rules. By adding an SSID rule at the top of my config to route through DIRECT, I was able to roughly mimic the feature I wanted. Even better, it’s compatible with Surge configuration files.

::github{repo="getsurfboard/surfboard"}

SurfBoard defaults to using FakeIP and won’t let you change that—even with SSID rules, requests resolve to FakeIP first—so global bypass works more thoroughly. But overall, it’s a workable compromise.

### Expense Tracking

Ironically, right before this switch I’d finally built the habit of tracking my expenses (for about two months now), not just logging daily spending but also tracking investment returns. On iOS, I highly recommend iCost: clean interface but packed with features, you can set up quick-entry shortcuts as system actions, trigger expense input by double-tapping the back or using the iPhone 16’s action button, and even have AI auto-fill most details for you. iCost supposedly has plans for an Android version, but after two years of “planning,” not much progress.

There are tons of expense apps discussed on Xiaohongshu—“the three big pillars of Chinese indie development” being notes, todo, and expense tracking. I finally settled on an older but well-respected one: Qianji (“MoneyTrace”), which actually predates iCost. It supports cross-platform sync: iOS, MacOS, Android, Windows, even HarmonyOS Next, and importing old bills from iCost is a breeze. All the expected features are there: asset management, credit card repayments, refunds, multi-currency, multiple ledgers (not that I use all that). Here’s their [homepage](https://qianjiapp.com).

Auto-logging on Qianji actually feels even better than iCost, though that may be a platform difference. Qianji uses Android’s accessibility system to recognize when you have a bill open (Alipay/WeChat) and pops up a small overlay for quick entry. Accuracy could use some improvement—sometimes if you jump to Alipay from another app, the overlay misses and you need to grab it from the payment history. Still, it’s a solid workflow.

### Calendar/Todo

The headline feature of iOS 18 is integration between calendar and reminders, letting you view and manipulate all your todos straight from the calendar. Thanks to Apple’s best-in-class notification system, reminders are always timely—probably the most productivity-boosting native tool on iOS, better than many paid apps. So after switching to Android, the stock calendar was eliminated first: it’s totally non-portable—change brands, and poof, your data is gone.

I checked out a bunch of options before settling on Microsoft Outlook. Oddly enough for a mail app, its calendar features are great. Downside: there’s no native lunar/special calendar support, so you have to subscribe to third-party calendars, which ends up crowding every day with holiday, birthday, and anniversary markers—hard to actually see when you’re truly busy. Todo functionality is basic at best.

Then I remembered old reliable TickTick, so I gave it a spin—and unexpectedly, it’s the perfect replacement for iOS calendar + todo. Supports lunar calendar, holidays, countdowns, anniversaries, todo display, all out of the box. Even the Eisenhower matrix (four quadrants) I had to set up manually on iOS is built in here. The only downside is the 139 RMB/year subscription—my issue, not theirs.

### Watch

Switching to Android, I finally said goodbye to the impressive but impractical Apple Watch—no more daily charging! Since I have an Oppo phone, it only made sense to get the Oppo Watch X2, which, amusingly, costs nearly as much as a brand new Apple Watch.

The Oppo Watch X2 stands out with its round dial—a rarity among smartwatches—and most watch faces go for a skeuomorphic look, which is actually quite refreshing. My requirements are simple: time, notifications, alarms, sleep and health tracking. That’s all covered, but I was especially impressed with HRV (heart rate variability) monitoring—a feature largely ignored by Apple Watch (often requiring third-party apps to even view). On the Oppo, HRV is given center stage, with its own wellness page, and endorsed by professional athlete Sun Yingsha.

### Conclusion

After all this tinkering, I finally have a phone that’s a pleasure to use—and best of all, my camera passes muster with my partner. Perfect~