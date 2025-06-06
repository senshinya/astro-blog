---
title: Astro 接入 Google Analytics (Tag Manager)
lang: zh
published: 2025-05-28T22:09:00.000+08:00
tags: ["折腾","Astro","Google Tag Manager","Google Analytics","GTM","partytown"]
abbrlink: fiddling/astro-google-tag-manager
description: "在将博客迁移至 Astro 框架后，常规的 Google Analytics 接入方法因性能因素而不再适用。尽管可以在 head 标签中直接添加 js 代码进行事件上报，这会影响页面性能。为了保持 Astro 的高效表现，采用了 partytown 技术，将脚本从主线程中剥离，确保加载过程不受影响。在此基础上，结合 demo 代码成功实现了 Google Analytics 的无缝接入，达成了性能与数据分析的平衡。"
---

### 前言

不想看废话可直接跳转解决方案一节

此前一直在 Google Analytics 上看博客的访问量，分析各种 referer 等信息。使用 hexo 和 hugo 等静态博客框架，都可以很容易的接入 Google Analytics，直接在 head 标签中添加 js 代码即可。前些日子将博客迁移到了 Astro 框架，诚然可以用老办法，直接在 head 执行 js 代码上报事件，但是就会造成性能下降。众所周知，Astro 追求极致前端性能、尽量 0 JS 执行。一旦使用 js 上报事件，就会造成性能损失

![性能满昏！](https://blog-img.shinya.click/2025/e1e778992ea6b393ed763a8642db3770.png)

于是网上冲浪了一番，搜到的大部分教程是使用 partytown 来将脚本剥离主线程执行，不阻塞主线程加载，以保证性能，并都给出了 demo 代码。于是在给出的 demo 基础上，我将其嵌入了我的博客。于是就得到了以下结果：

![](https://blog-img.shinya.click/2025/e5005b9f2321f6946761eef52156e777.png)

上报直接掉零了

很难绷，于是开始了漫长的排查，始终没能找到问题所在。网上找到的所有相关例子都和我的方式相同。都有些奇怪，这些人写完教程都不自己测试一下吗，完全不可用啊

只得将其搁置了俩月，期间临时改用了 umami 统计数据

这两天又想了起来，如芒在背如鲠在喉，于是又开始了漫长的搜索。最终在 GitHub 的一个 [角落](https://github.com/QwikDev/partytown/issues/382#issuecomment-1667675238) 中找到了解决方案

### 解决方案

安装 `@astrojs/partytown`，直接使用你的包管理器安装即可

`<head>` 标签中添加以下代码

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

有以下几个注意点：
- `is:inline` 指示脚本在客户端执行
- `type="text/partytown"` 指示脚本由 partytown 执行，而不在主线程执行
- `gtag` 函数必须定义为 window 对象的一个函数变量，不能定义为一个函数声明（很奇怪）

在 astro 的配置文件（形如是 `astro.config.ts` 或 `astro.config.mjs`）中添加以下配置

```js
import partytown from '@astrojs/partytown'

export default defineConfig({
  // ...
  integrations: [partytown({ config: { forward: ['dataLayer.push', 'gtag'] } })],
});
```

大部分教程都没有提到还需要将 `gtag` 加入 forward 数组

完成！提交部署后，Google Analytics 的统计数据就可以正常上报了