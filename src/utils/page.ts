import { moreLocales } from '@/config'
import { getLangFromPath } from '@/i18n/lang'
import { getLocalizedPath } from '@/i18n/path'

// Checks if normalized path matches a specific page type
function isPageType(path: string, prefix: string = '') {
  // Removes leading and trailing slashes from a path
  const normalizedPath = path.replace(/^\/|\/$/g, '')

  if (prefix === '') {
    return normalizedPath === '' || moreLocales.includes(normalizedPath)
  }

  return normalizedPath.startsWith(prefix)
    || moreLocales.some(lang => normalizedPath.startsWith(`${lang}/${prefix}`))
}

export function isHomePage(path: string) {
  return isPageType(path)
}

export function isPostPage(path: string) {
  const categories = ['daily', 'fiddling', 'notes', 'projects']
  return categories.some(category => isPageType(path, category))
}

export function isTagPage(path: string) {
  return isPageType(path, 'tags')
}
export function isMemosPage(path: string) {
  return isPageType(path, 'memos')
}
export function isFriendsPage(path: string) {
  return isPageType(path, 'friends')
}

export function isAboutPage(path: string) {
  return isPageType(path, 'about')
}

// Returns page context with language, page types and localization helper
export function getPageInfo(path: string) {
  const currentLang = getLangFromPath(path)
  const isHome = isHomePage(path)
  const isPost = isPostPage(path)
  const isTag = isTagPage(path)
  const isMemos = isMemosPage(path)
  const isFriends = isFriendsPage(path)
  const isAbout = isAboutPage(path)

  return {
    currentLang,
    isHome,
    isPost,
    isTag,
    isMemos,
    isFriends,
    isAbout,
    getLocalizedPath: (targetPath: string) =>
      getLocalizedPath(targetPath, currentLang),
  }
}
