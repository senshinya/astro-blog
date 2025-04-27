import {
  defineConfig,
  presetAttributify,
  presetWind3,
  transformerDirectives,
  transformerVariantGroup,
  type Preset,
} from 'unocss'
import presetTheme from 'unocss-preset-theme'
import { themeConfig } from './src/config.ts'

const { light, dark } = themeConfig.color

export default defineConfig({
  presets: [
    presetWind3(),
    presetAttributify(),
    presetTheme({
      theme: {
        dark: {
          colors: {
            ...dark,
            note: 'oklch(70.7% 0.165 254.624 / 0.8)', // blue-400
            tip: 'oklch(76.5% 0.177 163.223 / 0.8)', // emerald-400
            important: 'oklch(71.4% 0.203 305.504 / 0.8)', // purple-400
            warning: 'oklch(82.8% 0.189 84.429 / 0.8)', // amber-400
            caution: 'oklch(70.4% 0.191 22.216 / 0.8)', // red-400
          },
        },
      },
    }) as Preset<object>,
  ],
  theme: {
    colors: {
      ...light,
      note: 'oklch(48.8% 0.243 264.376 / 0.8)', // blue-700
      tip: 'oklch(50.8% 0.118 165.612 / 0.8)', // emerald-700
      important: 'oklch(49.6% 0.265 301.924 / 0.8)', // purple-700
      warning: 'oklch(55.5% 0.163 48.998 / 0.8)', // amber-700
      caution: 'oklch(50.5% 0.213 27.518 / 0.8)', // red-700
    },
    fontFamily: {
      title: ['Snell-Black', 'EarlySummer-Subset', 'EarlySummer', 'ui-serif', 'Georgia', 'Cambria', 'Times New Roman', 'Times', 'serif'],
      navbar: ['STIX-Italic', 'EarlySummer-Subset', 'EarlySummer', 'ui-serif', 'Georgia', 'Cambria', 'Times New Roman', 'Times', 'serif'],
      time: ['Snell-Bold', 'ui-serif', 'Georgia', 'Cambria', 'Times New Roman', 'Times', 'serif'],
      serif: ['STIX', 'EarlySummer', 'Georgia', 'ui-serif', 'Georgia', 'Cambria', 'Times New Roman', 'Times', 'serif'],
    },
  },
  shortcuts: {
    'uno-desktop-column': 'fixed w-14rem right-[max(5.625rem,calc(50vw-34.375rem))]',
    'uno-tags-style': 'inline-block whitespace-nowrap border border-secondary/25 rounded-full px-3.2 py-0.7 c-secondary transition-colors hover:(border-secondary/75 text-primary)',
    'uno-decorative-line': 'h-0.25 w-10 bg-secondary/25 mb-4.5 lg:(w-11 mb-6)',
    'uno-tags-wrapper': 'flex flex-wrap gap-x-3 gap-y-3.2',
  },
  rules: [
    ['scrollbar-hidden', {
      'scrollbar-width': 'none',
      '-ms-overflow-style': 'none',
    }],
    ['ios-flash-fix', {
      'backface-visibility': 'hidden',
      '-webkit-backface-visibility': 'hidden',
    }],
    ['force-gpu', {
      'transform': 'translateZ(0)',
      '-webkit-transform': 'translateZ(0)',
    }],
  ],
  transformers: [
    transformerDirectives(),
    transformerVariantGroup(),
  ],
})
