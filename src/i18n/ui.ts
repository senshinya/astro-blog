import type { Language } from '@/i18n/config'

interface Translation {
  title: string
  subtitle: string
  description: string
  posts: string
  tags: string
  memos: string
  friends: string
  about: string
  toc: string
  search: {
    placeholder: string
    emptyState: string
    loadingState: string
    noResultsState: string
    noTitle: string
    navigation: string
    select: string
    poweredBy: string
    ariaLabel: string
  }
}

export const ui: Record<Language, Translation> = {
  zh: {
    title: '信也のブログ',
    subtitle: '一写代码的',
    description: '互联网自留地',
    posts: '文章',
    tags: '标签',
    memos: '碎语',
    friends: '友人',
    about: '关于',
    toc: '目录',
    // 搜索相关
    search: {
      placeholder: '搜索文章...',
      emptyState: '输入关键词开始搜索',
      loadingState: '搜索中...',
      noResultsState: '未找到相关内容',
      noTitle: '无标题',
      navigation: '导航',
      select: '选择',
      poweredBy: '由 Pagefind 驱动',
      ariaLabel: '搜索文章',
    },
  },
  en: {
    title: '信也のブログ',
    subtitle: 'Coder',
    description: 'A personal haven on the Internet',
    posts: 'Posts',
    tags: 'Tags',
    memos: 'Memos',
    friends: 'Friends',
    about: 'About',
    toc: 'Table of Contents',
    // 搜索相关
    search: {
      placeholder: 'Search articles...',
      emptyState: 'Enter keywords to start searching',
      loadingState: 'Searching...',
      noResultsState: 'No results found',
      noTitle: 'Untitled',
      navigation: 'Navigate',
      select: 'Select',
      poweredBy: 'Powered by Pagefind',
      ariaLabel: 'Search articles',
    },
  },
  ja: {
    title: '信也のブログ',
    subtitle: 'コーダー',
    description: 'インターネット上のプライベート空間',
    posts: '記事',
    tags: 'タグ',
    memos: '独り言',
    friends: '友達',
    about: '概要',
    toc: '目次',
    // 搜索相关
    search: {
      placeholder: '記事を検索...',
      emptyState: 'キーワードを入力して検索を開始',
      loadingState: '検索中...',
      noResultsState: '関連する内容が見つかりません',
      noTitle: 'タイトルなし',
      navigation: 'ナビゲーション',
      select: '選択',
      poweredBy: 'Pagefind で駆動',
      ariaLabel: '記事を検索',
    },
  },
}
