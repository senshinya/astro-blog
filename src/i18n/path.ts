/**
 * Multi-language path generation and navigation utilities
 *
 * Provides functions to generate localized paths, handle language switching,
 * and build URLs for multi-language navigation in Astro applications.
 */

import { defaultLocale, moreLocales } from '@/config'
import { getLangFromPath, getNextGlobalLang } from '@/i18n/lang'

/**
 * Get path to tag page with language support
 * @param tagName Tag name
 * @param lang Current language code
 * @returns Path to tag page
 */
export function getTagPath(tagName: string, lang: string): string {
  return lang === defaultLocale
    ? `/tags/${tagName}/`
    : `/${lang}/tags/${tagName}/`
}

// Generates a localized path based on current language
export function getLocalizedPath(path: string, currentLang?: string) {
  const clean = path.replace(/^\/|\/$/g, '')
  const lang = currentLang || getLangFromPath(path)

  if (clean === '') {
    return lang === defaultLocale ? '/' : `/${lang}/`
  }

  return lang === defaultLocale ? `/${clean}/` : `/${lang}/${clean}/`
}

/**
 * Build path for next language
 * @param currentPath Current page path
 * @param currentLang Current language code
 * @param nextLang Next language code to switch to
 * @returns Path for next language
 */
export function buildNextLangPath(currentPath: string, currentLang: string, nextLang: string): string {
  if (currentPath === '/') {
    return nextLang === defaultLocale ? '/' : `/${nextLang}/`
  }

  let nextPath: string

  if (nextLang === defaultLocale) {
    nextPath = currentPath.replace(`/${currentLang}`, '') || '/'
  }
  else if (currentLang === defaultLocale) {
    nextPath = `/${nextLang}${currentPath}`
  }
  else {
    nextPath = currentPath.replace(`/${currentLang}`, `/${nextLang}`)
  }

  return nextPath.endsWith('/') ? nextPath : `${nextPath}/`
}

/**
 * Get next language path from global language list
 * @param currentPath Current page path
 * @returns Path for next supported language
 */
export function getNextGlobalLangPath(currentPath: string): string {
  const currentLang = getLangFromPath(currentPath)
  const nextLang = getNextGlobalLang(currentLang)
  return buildNextLangPath(currentPath, currentLang, nextLang)
}

/**
 * Get next language path from supported language list
 * @param currentPath Current page path
 * @param supportedLangs List of supported language codes
 * @returns Path for next supported language
 */
export function getNextSupportedLangPath(currentPath: string, supportedLangs: string[]): string {
  if (!supportedLangs.length) {
    return getNextGlobalLangPath(currentPath)
  }

  // Sort supported languages by global priority
  const langPriority = new Map(
    [defaultLocale, ...moreLocales].map((lang, index) => [lang, index]),
  )
  const sortedLangs = [...supportedLangs].sort(
    (a, b) => (langPriority.get(a) ?? 0) - (langPriority.get(b) ?? 0),
  )

  // Get current language and next in cycle
  const currentLang = getLangFromPath(currentPath)
  const currentIndex = sortedLangs.indexOf(currentLang)
  const nextLang = sortedLangs[(currentIndex + 1) % sortedLangs.length]

  return buildNextLangPath(currentPath, currentLang, nextLang)
}
