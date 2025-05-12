import mdx from '@astrojs/mdx'
import partytown from '@astrojs/partytown'
import sitemap from '@astrojs/sitemap'
import robotsTxt from 'astro-robots-txt'
import { defineConfig } from 'astro/config'
import rehypeExternalLinks from 'rehype-external-links'
import rehypeKatex from 'rehype-katex'
import remarkDirective from 'remark-directive'
import remarkMath from 'remark-math'
import UnoCSS from 'unocss/astro'
import { themeConfig } from './src/config'
import { langMap } from './src/i18n/config'
import { rehypeImgToFigure } from './src/plugins/rehype-img-to-figure.mjs'
import { remarkAdmonitions } from './src/plugins/remark-admonitions.mjs'
import { remarkGithubCard } from './src/plugins/remark-github-card.mjs'
import { remarkReadingTime } from './src/plugins/remark-reading-time.mjs'

const url = themeConfig.site.url
const locale = themeConfig.global.locale
const linkPrefetch = themeConfig.preload.linkPrefetch
const imageHostURL = themeConfig.preload.imageHostURL
const imageConfig = imageHostURL
  ? {
      // Configure domains and remotePatterns to optimize remote images in Markdown files using ![alt](src) syntax
      // Docs: https://docs.astro.build/en/guides/images/#authorizing-remote-images
      image: {
        domains: [imageHostURL],
        remotePatterns: [{ protocol: 'https' }],
      },
    }
  : {}

export default defineConfig({
  site: url,
  base: '/',
  trailingSlash: 'ignore',
  prefetch: {
    prefetchAll: true,
    defaultStrategy: linkPrefetch,
  },
  ...imageConfig,
  i18n: {
    locales: Object.entries(langMap).map(([path, codes]) => ({
      path,
      codes: codes as [string, ...string[]],
    })),
    defaultLocale: locale,
  },
  integrations: [
    UnoCSS({
      injectReset: true,
    }),
    mdx(),
    partytown({
      config: {
        forward: ['dataLayer.push'],
      },
    }),
    sitemap(),
    robotsTxt(),
  ],
  markdown: {
    remarkPlugins: [
      remarkDirective,
      remarkMath,
      remarkAdmonitions,
      remarkGithubCard,
      remarkReadingTime,
    ],
    rehypePlugins: [
      rehypeKatex,
      rehypeImgToFigure,
      [
        rehypeExternalLinks,
        {
          target: '_blank',
          rel: ['nofollow', 'noopener', 'noreferrer', 'external'],
          protocols: ['http', 'https', 'mailto'],
        },
      ],
    ],
    shikiConfig: {
      // Available themes: https://shiki.style/themes
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
    },
  },
  devToolbar: {
    enabled: false,
  },
  server: {
    headers: {
      "Access-Control-Allow-Origin": "https://giscus.app"
    }
  },
  security: {
    checkOrigin: true,
  }
})
