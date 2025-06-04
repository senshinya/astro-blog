/**
 * Multi-language path parsing and language switching utilities
 *
 * Provides functions to extract language codes from URL paths and handle
 * language cycling for multi-language navigation in Astro applications.
 */

import { allLocales, defaultLocale, moreLocales } from '@/config'

// Gets the language code from the current path
export function getLangFromPath(path: string) {
  return moreLocales.find(lang =>
    path.startsWith(`/${lang}/`)) ?? defaultLocale
}

// Get the next language code in the global language cycle
export function getNextGlobalLang(currentLang: string): string {
  // Get index of current language
  const currentIndex = allLocales.indexOf(currentLang)
  if (currentIndex === -1) {
    return defaultLocale
  }

  // Calculate and return next language in cycle
  const nextIndex = (currentIndex + 1) % allLocales.length
  return allLocales[nextIndex]
}
