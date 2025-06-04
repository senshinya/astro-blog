import antfu from '@antfu/eslint-config'

export default antfu({
  unocss: true,
  typescript: true,
  astro: true,
  ignores: ['public/vendors/**'],
})
