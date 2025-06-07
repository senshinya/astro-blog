// Global Language Map
export const langMap: Record<string, string[]> = {
  'zh': ['zh-CN'],
  'en': ['en-US'],
}

// Waline Language Map
// https://waline.js.org/en/guide/features/i18n.html
export const walineLocaleMap: Record<string, string> = {
  'de': 'en-US', // fallback to English
  'en': 'en-US',
  'es': 'es',
  'fr': 'fr-FR',
  'ja': 'jp-JP',
  'ko': 'en-US', // fallback to English
  'pl': 'en-US', // fallback to English
  'pt': 'pt-BR',
  'ru': 'ru-RU',
  'zh': 'zh-CN',
}

// Giscus Language Map
// https://giscus.app/
export const giscusLocaleMap: Record<string, string> = {
  'de': 'de',
  'en': 'en',
  'es': 'es',
  'fr': 'fr',
  'ja': 'ja',
  'ko': 'ko',
  'pl': 'pl',
  'pt': 'pt',
  'ru': 'ru',
  'zh': 'zh-CN',
  'zh-tw': 'zh-TW',
}

// Supported Languages
export const supportedLangs = Object.keys(langMap).flat()
