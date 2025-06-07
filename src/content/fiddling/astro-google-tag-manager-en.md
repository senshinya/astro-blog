---
title: Integrating Google Analytics (Tag Manager) with Astro
lang: en
published: 2025-05-28T22:09:00.000+08:00
tags: ["fiddling", "Astro", "Google Tag Manager", "Google Analytics", "GTM", "partytown"]
abbrlink: astro-google-tag-manager
description: "After migrating my blog to the Astro framework, I found that the usual method for integrating Google Analytics no longer fit the bill due to performance concerns. While it's possible to add JavaScript directly to the head tag for event reporting, this dampens page performance. To preserve Astro's signature efficiency, I opted for Partytown to offload scripts from the main thread—keeping the load process smooth. Building on available demo code, I achieved seamless Google Analytics integration, balancing performance with data analytics needs."
---

### Introduction

If you’d like to dive straight into the solution, feel free to skip ahead.

I've always kept an eye on my blog traffic using Google Analytics, analyzing various referrers and metrics. With static site generators like Hexo and Hugo, hooking up Google Analytics was a breeze—you just drop the JavaScript snippet into the head tag and you’re good to go. Recently, I migrated my blog to Astro. Technically, the old method still works—just report events by executing JS in the head—but this comes at the cost of performance. As we all know, Astro is obsessed with razor-sharp frontend performance and as close to zero JS execution as possible. Executing JS for event reporting is directly at odds with that philosophy.

![Awesome Performance!](https://blog-img.shinya.click/2025/e1e778992ea6b393ed763a8642db3770.png)

So I did some surfing and most of the guides I found recommended Partytown: a tool that offloads scripts from the main thread, ensuring they don’t block your page load and keeping performance intact. Many of these guides included some sample code. Naturally, I embedded similar demo code into my blog. Here's what happened:

![](https://blog-img.shinya.click/2025/e5005b9f2321f6946761eef52156e777.png)

Analytics reporting flatlined.

It was pretty frustrating. I spent ages troubleshooting but couldn’t figure out what was wrong. Every example I found online used the same approach as I did. Kind of makes you wonder—did nobody actually test their own tutorials? None of them worked for me.

With no other choice, I shelved the effort for a couple of months and switched to Umami for site analytics in the meantime.

Recently, that unresolved issue started nagging at me again, so I resumed my search. Finally, buried in a [GitHub thread](https://github.com/QwikDev/partytown/issues/382#issuecomment-1667675238), I stumbled on an actual solution.

### Solution

First, install `@astrojs/partytown` using your preferred package manager.

In your `<head>` tag, add the following code:

```html
<script is:inline src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXX" type="text/partytown"></script>
<script is:inline type="text/partytown">
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
        dataLayer.push(arguments);
    };
  window.gtag('js', new Date());
  window.gtag('config', 'G-XXXXXXXXX');
</script>
```

A few key points:
- `is:inline` instructs Astro to execute the script on the client side.
- `type="text/partytown"` tells Partytown to handle the script, keeping it off the main thread.
- The `gtag` function **must** be assigned to the `window` object as a function variable, not a function declaration (peculiar, but necessary).

Next, add this configuration in your Astro config file (such as `astro.config.ts` or `astro.config.mjs`):

```js
import partytown from '@astrojs/partytown'

export default defineConfig({
  // ...
  integrations: [partytown({ config: { forward: ['dataLayer.push', 'gtag'] } })],
});
```

Worth noting: most guides miss the crucial step of forwarding `'gtag'` in the array.

That’s it! After you commit and deploy, Google Analytics should start receiving data from your site as expected.