import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import process from 'node:process'
import { themeConfig } from '../src/config'

// pnpm new-post
// pnpm new-post first-post
// pnpm new-post first-post.md
// pnpm new-post first-post.mdx
// pnpm new-post 2025/03/first-post
// pnpm new-post 2025/03/first-post.md
// pnpm new-post 2025/03/first-post.mdx

// Process file path
const rawPath = process.argv[2] || 'new-post'
const baseName = basename(rawPath).replace(/\.(md|mdx)$/, '')
const targetFile = ['.md', '.mdx'].includes(extname(rawPath))
  ? rawPath
  : `${rawPath}.md`
const fullPath = join('src/content/posts', targetFile)

// Check if file already exists
if (existsSync(fullPath)) {
  console.error(`❌ File already exists: ${fullPath}`)
  process.exit(1)
}

// Create directory structure
mkdirSync(dirname(fullPath), { recursive: true })

// Prepare file content
const today = new Date().toISOString().split('T')[0]
const content = `---
title: ${baseName}
published: ${today}

# Optional
description: ''
updated: ''
tags:
  - Note

# Advanced
draft: false
pin: 0
toc: ${themeConfig.global.toc}
lang: ''
abbrlink: ''
---

`

// Write to file
try {
  writeFileSync(fullPath, content)
  console.log(`✅ Post created: ${fullPath}`)
}
catch (error) {
  console.error('❌ Failed to create post:', error)
  process.exit(1)
}
