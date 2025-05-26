// Global Language Map
export const langMap: Record<string, string[]> = {
  'zh': ['zh-CN'],
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

// Supported Languages
export const supportedLangs = Object.keys(langMap).flat()
