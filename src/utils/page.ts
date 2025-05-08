import { moreLocales } from '@/config'
import { getLangFromPath } from '@/i18n/lang'
import { getLocalizedPath } from '@/i18n/path'

// Removes leading and trailing slashes from a path
export function cleanPath(path: string) {
  return path.replace(/^\/|\/$/g, '')
}

// Checks if the current path is the home/post/tag/about page
export function isHomePage(path: string) {
  const clean = cleanPath(path)
  return clean === '' || moreLocales.includes(clean)
}
export function isPostPage(path: string) {
  const clean = cleanPath(path)
  const categories = ['daily', 'fiddling', 'notes', 'projects']
  return categories.some(category => clean.startsWith(category)) || 
         moreLocales.some(lang => categories.some(category => clean.startsWith(`${lang}/${category}`)))
}
export function isTagPage(path: string) {
  const clean = cleanPath(path)
  return clean.startsWith('tags') || moreLocales.some(lang => clean.startsWith(`${lang}/tags`))
}
export function isMemosPage(path: string) {
  const clean = cleanPath(path)
  return clean.startsWith('memos') || moreLocales.some(lang => clean.startsWith(`${lang}/memos`))
}
export function isFriendsPage(path: string) {
  const clean = cleanPath(path)
  return clean.startsWith('friends') || moreLocales.some(lang => clean.startsWith(`${lang}/friends`))
}
export function isAboutPage(path: string) {
  const clean = cleanPath(path)
  return clean.startsWith('about') || moreLocales.some(lang => clean.startsWith(`${lang}/about`))
}

// Returns page context including language and page type information
export function getPageInfo(path: string) {
  const currentLang = getLangFromPath(path)

  return {
    currentLang,
    isHome: isHomePage(path),
    isPost: isPostPage(path),
    isTag: isTagPage(path),
    isMemos: isMemosPage(path),
    isFriends: isFriendsPage(path),
    isAbout: isAboutPage(path),
    getLocalizedPath: (targetPath: string) => getLocalizedPath(targetPath, currentLang),
  }
}
