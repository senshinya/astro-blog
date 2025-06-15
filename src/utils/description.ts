import type { CollectionEntry } from 'astro:content'
import MarkdownIt from 'markdown-it'
import { defaultLocale } from '@/config'

type ExcerptScene = 'list' | 'meta' | 'og' | 'feed'

const parser = new MarkdownIt()
const isCJKLang = (lang: string) => ['zh', 'zh-tw', 'ja', 'ko'].includes(lang)

// Excerpt length in different scenarios
const EXCERPT_LENGTHS: Record<ExcerptScene, {
  cjk: number
  other: number
}> = {
  list: {
    cjk: 120,
    other: 240,
  },
  meta: {
    cjk: 120,
    other: 240,
  },
  og: {
    cjk: 70,
    other: 140,
  },
  feed: {
    cjk: 70,
    other: 140,
  },
}

const HTML_ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&apos;': '\'',
  '&nbsp;': ' ',
}

// Generate an excerpt from Markdown content
export function generateExcerpt(
  content: string,
  scene: ExcerptScene,
  lang: string,
): string {
  if (!content) {
    return ''
  }

  // Remove HTML comments and Markdown headings
  const contentWithoutHeadings = content
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6}\s+\S.*$/gm, '')
    .replace(/\n{2,}/g, '\n\n')

  const length = isCJKLang(lang)
    ? EXCERPT_LENGTHS[scene].cjk
    : EXCERPT_LENGTHS[scene].other

  // Remove all HTML tags
  let plainText = parser.render(contentWithoutHeadings)
    .replace(/<[^>]*>/g, '')

  // Decode HTML entities using the mapping table
  Object.entries(HTML_ENTITIES).forEach(([entity, char]) => {
    plainText = plainText.replace(new RegExp(entity, 'g'), char)
  })

  // Replace line breaks with spaces
  const normalizedText = plainText.replace(/\s+/g, ' ')
    // Remove spaces after CJK punctuation marks
    .replace(/([。？！："」』])\s+/g, '$1')
  const excerpt = normalizedText.slice(0, length).trim()
  // Remove trailing punctuation from the excerpt
  if (normalizedText.length > length) {
    return `${excerpt.replace(/\p{P}+$/u, '')}...`
  }
  return excerpt
}

// Automatically Generate article description
export function generateDescription(
  post: CollectionEntry<'posts'>,
  scene: ExcerptScene,
): string {
  const lang = post.data.lang || defaultLocale

  // Prioritize existing description
  if (post.data.description) {
    // Only apply character limits in OG scene
    return scene === 'og'
      ? generateExcerpt(post.data.description, scene, lang)
      : post.data.description
  }

  return generateExcerpt(post.body || '', scene, lang)
}
