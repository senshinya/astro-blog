import { glob } from 'astro/loaders'
import { defineCollection, z } from 'astro:content'
import { allLocales, themeConfig } from '@/config'

const posts = defineCollection({
  loader: glob({ pattern: ['**/*.{md,mdx}', '!**/about/**', '!**/friends/**', '!**/travels/**'], base: './src/content' }),
  schema: z.object({
    // required
    title: z.string(),
    published: z.date(),
    // optional
    description: z.string().optional().default(''),
    updated: z.preprocess(
      val => val === '' ? undefined : val,
      z.date().optional(),
    ),
    tags: z.array(z.string()).optional().default([]),
    // Advanced
    draft: z.boolean().optional().default(false),
    pin: z.number().int().min(0).max(99).optional().default(0),
    toc: z.boolean().optional().default(themeConfig.global.toc),
    lang: z.enum(['', ...allLocales]).optional().default(''),
    abbrlink: z.string().optional().default('').refine(
      abbrlink => !abbrlink || /^[a-z0-9\-\/]*$/.test(abbrlink),
      { message: 'Abbrlink can only contain lowercase letters, numbers and hyphens' },
    ),
    optimizeImages: z.boolean().default(true),
  }),
})

const about = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/about' }),
  schema: z.object({
    lang: z.enum(['', ...allLocales]).optional().default(''),
  }),
})

const travels = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/travels' }),
  schema: z.object({
    title: z.string(),
    published: z.date(),
    subtitle: z.string(),
    posttitle: z.string(),
    coverImage: z.string(),
    draft: z.boolean().optional().default(false),
    lang: z.enum(['', ...allLocales]).optional().default(''),
    abbrlink: z.string().optional().default('').refine(
      abbrlink => !abbrlink || /^[a-z0-9\-\/]*$/.test(abbrlink),
      { message: 'Abbrlink can only contain lowercase letters, numbers and hyphens' },
    ),
    description: z.string(),
    days: z.array(
      z.object({
        title: z.string(),
        descriptions: z.array(z.string()),
        photos: z.array(
          z.object({
            src: z.string(),
            alt: z.string(),
            lat: z.number().optional(),
            lng: z.number().optional(),
            caption: z.string()
          })
        )
      })
    )
  })
})

const friends = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/friends' }),
  schema: z.object({
    lang: z.enum(['', ...allLocales]).optional().default(''),
  }),
})

export const collections = { posts, about, travels, friends }
