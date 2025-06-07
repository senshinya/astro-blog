---
title: It's Not Impossible to Stay Somewhat Mentally Healthy After Three Years at ByteDance
tags: ["daily", "work", "year-in-review"]
lang: en
published: 2024-09-28T16:26:00+08:00
abbrlink: daily/work-for-3-years
description: "Three years at ByteDance, and it's as if time has quietly accelerated. Amid rapid change, it’s still possible to find a sliver of mental balance. I remember my early confusion: a young me, standing on the balcony of Hangzhou Bafang City, gazing at the distant mountains, full of expectation and curiosity for the future. As time went on, work challenges and personal growth intertwined. This created a unique, vibrant experience—and taught me how to find my own rhythm amidst the hustle."
---

![Header Image](https://blog-img.shinya.click/1726828874334.jpg)

During dinner, a colleague started talking about his new car, and suddenly exclaimed, “It feels like time flies ever since we started working.”

Me: “Well, I’m not so sure. Friday afternoons always seem to drag on forever.”

I still hesitate to admit it, always seeing myself as a student (I’m still the youngest in the team for now), but it’s been over three years since I officially left campus. It was a turbulent, yet fairly stable, three years.

There’s an old saying inside ByteDance: “One year at ByteDance is worth three in the real world.” If you do the math, I’ve basically spent “nine years” here already.

### The Beginner

If you don’t count my internship, I officially joined ByteDance Hangzhou in late June of 2021.

See the VCR here: [A Note from My First Week on the Job](https://www.nowcoder.com/share/jump/67966291840886568)

ByteDance rented two towers in Bafang City, but not the whole buildings—just the top five or six floors in each. The view was nice, though. Every day I’d lean on the balcony, taking in the distant EFC (the most city-like part of Yuhang) and, further out, the southern Yuhang mountains. Whether it was about to rain or had just cleared, the scenery was unbeatable.

I joined a ToC group under the Douyin Live division. Since I had interned for two months in advance and helped build the onboarding docs, I was already familiar with both the business and the team. But because I had to return to school for graduation paperwork after my internship and was delayed for another month, when I eventually started, there were suddenly no tasks assigned to me. So I enjoyed a blissful period of “slacking,” taking home double overtime pay every other week for my last month before work picked up.

Then, out of the blue, my leader and mentor pulled me aside to ask if I’d be willing to volunteer for a Beijing-based project. Turns out, it was a fast-growing ToB platform under our same +2, and they were short-staffed, asking around for help—which ended up falling on my team. Freshly graduated and full of energy (and bored), I immediately said yes.

I started following the Beijing team’s tasks. This was an upward management tool—the platform's QPS was low, mainly focused on generating reports for higher-ups, totally different from ToC work: business goals far outweigh technical performance, and even consistency wasn't a big deal at first. If a call failed, you just set up an alert and check it manually—no big deal, sometimes not even worth fixing. User operations were rare, so maintenance was very relaxed.

When I joined, the platform was going through a major version overhaul. One of their devs mentored me remotely, guiding me through tiny tasks at first: minor fixes, small features, just to get me familiar with the process.

> [!TIP]
> Requirement Pre-review → Requirement Detailed Review → (Dev joins in) Technical Review → Dev Work → (QA joins in) Showcase → QA → Launch Review → Go Live

Everything was orderly—one task after another with nothing extra. At first, I barely knew what to say during tech reviews, even dressing up and booking a room just to be safe. Later… well, not much progress happened. I just got used to it—or numb to it—and started taking it less seriously. An offline bug wasn’t a big deal, and if there was one online, worst case, just fix the data.

Writing Go was basically like freelancing, and with quick iterations, there was never time for refactoring—if it ran, it was good. The repo grew increasingly chaotic. Every mishmash of complex requirements and people borrowed from all over led to a total mess of technical styles. The platform eventually became a true “big ball of mud.”

But what did that have to do with me? I was just the noob writing the small features.

Everything was new to me as a newcomer. I’d even come in on weekends—nothing to do at home alone anyway—so why not? Later, I got busy with my own side project: [MYDB](https://github.com/CN-GuoZiyang/Mydb) and its [tutorial](/en/projects/mydb/mydb0). Sure, it had bugs and was never fully tested, but I was absolutely hooked: leaving work around 8-9pm, coding until 1 or 2am, then showering, gaming, drinking a little, finally sleeping at 3 or 4.

I also made some interesting friends, started a tiny chat group, and whenever we weren’t working we’d be shooting the breeze there. At that point, ByteDance felt like everything I imagined about tech: freedom, flat management, no need for elaborate excuses for taking leave, I could install whatever I wanted on my work laptop, and because the pandemic wasn’t over, we worked from home half the time—no punch-clock or mandatory hours, rocking up at 11am and leaving after dinner…

### The Grind

That went on happily until early 2022. By then, I’d gone from just handling edge cases to gradually covering a whole domain.

There’s a saying at Alibaba, often used to comfort those who’ve been laid off (or by themselves as self-consolation): “Embrace change.”

> The only constant is change.

The platform was growing fast—the business expanding from live streaming to all of Douyin. Due to some Product changes, the original Beijing dev team handed off the platform, and—lucky me—my own team took over.

We started the handover: leading new people (from my team) through tasks, organizing knowledge-sharing sessions. I was already responsible for the budgeting module, so I led an internal talk. I read the docs from start to finish without much feeling, but it was my first actual presentation at work (no defense was needed to pass probation).

As the Beijing folks phased out, manpower became suddenly tight. I was handed the entire project domain on top of my module. Just as Product proposed a major feature, my first task in this area was basically to rewrite almost everything.

That feature butted right up against Chinese New Year, and it was urgent. Except for New Year’s Eve and Day, I spent the entire holiday at the library coding. Because of misunderstandings and my inexperience, I rewrote that code three or four times before barely making the first post-holiday release.

Afterwards came all the historic debts, refactoring reviews, and the migration of code to a new service (by the way, it started in 2022 and still isn’t done). I barely touched the ground, I was so busy.

It was a time of intense anxiety and brutal overtime. I was busy with various issues well past 10pm most nights. To cope, I’d indulge in revenge bedtime procrastination and entertainment: classics like drinking in an empty meeting room at the office on Friday nights, staying until Saturday morning before going home to sleep. 😅

Weirdly enough, whenever I worked late, I’d run into my team lead. Every night at 10 or 11pm, it was either him urging me to leave or vice versa. For convenience, I moved to an apartment right next to the office and commuted through the underground garage. He, with his family, commuted 50 minutes to an hour each way.

Maybe that’s the price you pay for having a family.

Owing to these late hours, I totally stopped all my other work and personal study. Once home, all I wanted was to drink and sleep. My drinks went from homemade cocktails to straight vodka or whiskey; my purpose changed from “this tastes good” to “this helps me sleep and kills the anxiety.”

### The Turning Point

> Sometimes you’d rather have life stand still, because the comfort of the familiar feels safer than the risks of the unknown.

But the risks came quickly.

In mid-2022, our team got a new +2, and the vibe began to shift. Casual ad-hoc meetings turned formal and process-heavy, every simple step broken up by endless new review points—each decision forced through layer after layer of scrutiny.

New metrics were invented: Bug-to-man-day ratios, productivity ratios, code complexity, and more. Good or bad numbers meant you’d be called out in the next meeting. Product, Dev, and QA stopped getting along. Meetings became battlegrounds full of blame-shifting and power plays, sapping everyone’s energy—coding in peace became a luxury. The new wisdom was: “do more, mess up more; do less, stay safe; always deflect when you can.” Where once “an online bug just meant fixing the data,” now “a single regression bug could get you axed.”

At the same time, the shrinking headcount meant the team started shrinking too. Many familiar faces, some voluntarily and some not, left. People I used to eat and slack with every day—I’d only see them once a week if that. The loneliness of work closed in hard.

<img src="https://blog-img.shinya.click/2024/630b780569e7aa8fa40e1ecc6a189b40.png" style="width: 50%"/>

Was this somatized emotion, or the toll from years of late nights and drinking, or both? Either way, my body started raising alarms. For the details, see: [The Long Road to Treating Chronic Gastritis](/en/daily/anti-chronic-gastritis).

Losing nearly 6kg in a month, the shock woke me up. I made a [strikeout: “slacker”] healthy living plan!

So I started getting up at 8:30am for breakfast at the office, leaving right after dinner around 6, running for half an hour after work, and aiming to sleep before midnight (still working on that).

> [!CAUTION]
> “Struggle? If you lose your health, how can you struggle at all?”

Thankfully, the previous wave of turmoil also scared away a bunch of Product folks, and the workload dropped sharply. Though management switched to “if we can’t mess with the work, let’s mess with the people,” with plenty of pointless reviews and annoying rituals (the new +2 is an ex-Ali type who loves forced team-building and performing for the sake of performing), the platform entered a low-maintenance phase with much less busywork.

The job market outside was bleak, so I decided to just coast along for a bit.

### Epilogue

This three-year “anniversary” post should have been finished in May or June, but with all the product upheaval and my health issues at the time, the draft languished in my notes for three months. Only recently, as my health stabilized, did I pick it up again. And yet, in just those three months, my mindset shifted from “striving for progress” to “just getting by”—it’s amazing how much life can change.

Still, I’ve managed to keep a certain level of mental health. Lately I’ve been looking into mood tracking and time management, trying to be more disciplined. For now, the main benefit is simply seeing where my time goes—but I’ll write a post about that soon.

The dream of studying abroad still tempts me—especially whenever things go badly at work. On countless late nights after a long day, the thought winds through my mind like ivy. The closest I came to quitting in these three years was replying to Feishu messages and handling on-calls while waiting for a gastroscopy in the hospital. I kept asking myself: “Is what I’m paying worth what I’m earning?” But whenever I calmed down, I just sighed and pressed those thoughts down.

Who knows—three years from now, will I regret or even hate my decisions today? Maybe that’s just the curse of making choices.

> Whatever you choose—or even if you don’t—you have to live with the consequences.