import mdx from '@astrojs/mdx'
import partytown from '@astrojs/partytown'
import sitemap from '@astrojs/sitemap'
import robotsTxt from 'astro-robots-txt'
import { defineConfig } from 'astro/config'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeExternalLinks from 'rehype-external-links'
import rehypeKatex from 'rehype-katex'
import rehypeSlug from 'rehype-slug'
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
// Configure domains and remotePatterns to optimize remote images in Markdown files using ![alt](src) syntax
// Docs: https://docs.astro.build/en/guides/images/#authorizing-remote-images
const imageConfig = imageHostURL
  ? { image: { domains: [imageHostURL], remotePatterns: [{ protocol: 'https' }] } }
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
      rehypeSlug,
      rehypeImgToFigure,
      [
        rehypeAutolinkHeadings,
        {
          behavior: 'append',
          test: ['h1', 'h2', 'h3', 'h4'],
          content: {
            type: 'element',
            tagName: 'svg',
            properties: {
              'viewBox': '0 0 24 24',
              'aria-hidden': 'true',
              'fill': 'currentColor',
            },
            children: [
              {
                type: 'element',
                tagName: 'path',
                properties: {
                  d: 'm7.374 15.182 7.85-7.849 1.413 1.414-7.848 7.85z',
                },
              },
              {
                type: 'element',
                tagName: 'path',
                properties: {
                  d: 'M10.6 20c-1.8 1.8-4.7 1.8-6.5 0-.9-.9-1.4-2-1.4-3.3s.5-2.4 1.4-3.3l3.8-3.8-1.4-1.4-4.2 4.2c-2.5 2.5-2.5 6.7 0 9.3 1.3 1.3 3 1.9 4.6 1.9s3.4-.6 4.6-1.9l4.2-4.2-1.4-1.4-3.8 3.8ZM21.7 2.3C20.5 1.1 18.8.4 17.1.4s-3.4.7-4.6 1.9L8.3 6.5l1.4 1.4 3.8-3.8c1.8-1.8 4.7-1.8 6.5 0 .9.9 1.4 2 1.4 3.3s-.5 2.4-1.4 3.3l-3.8 3.8 1.4 1.4 4.2-4.2c1.2-1.2 1.9-2.9 1.9-4.6s-.7-3.4-1.9-4.6Z',
                },
              },
            ],
          },
          properties: {
            className: ['heading-anchor-link'],
            ariaLabel: 'Link to this section',
          },
        },
      ],
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
