/**
 * Format Markdown files using autocorrect for consistent typography
 *
 * Scans Markdown files in src/content/, applies autocorrect formatting to content
 * while preserving frontmatter, and updates files only when changes are needed.
 *
 * Usage: pnpm format-posts
 * Target: src/content/**.md and src/content/**.mdx files
 */

import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { format } from 'autocorrect-node'
import fg from 'fast-glob'

function splitContent(content: string) {
  const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n([\s\S]*)$/m)
  if (!match) {
    return {
      frontmatter: '',
      body: content,
      hasFrontmatter: false,
    }
  }

  return {
    frontmatter: match[1],
    body: match[2],
    hasFrontmatter: true,
  }
}

async function main() {
  console.log('🔍 Scanning Markdown files...')

  const files = await fg(['src/content/**/*.{md,mdx}'])
  console.log(`📦 Found ${files.length} Markdown files`)

  let changedCount = 0
  let errorCount = 0

  for (const file of files) {
    try {
      const content = await readFile(file, 'utf8')
      const { frontmatter, body, hasFrontmatter } = splitContent(content)

      const formattedBody = format(body)
      const newContent = hasFrontmatter
        ? `---\n${frontmatter}\n---\n${formattedBody}`
        : formattedBody

      // Skip if content hasn't changed
      if (content === newContent)
        continue

      // Write updated content to file
      await writeFile(file, newContent, 'utf8')
      console.log(`✅ ${file}`)
      changedCount++
    }
    catch (error) {
      console.error(`❌ ${file}: ${(error as Error)?.message ?? String(error)}`)
      errorCount++
    }
  }

  // Report results
  if (changedCount === 0) {
    console.log(`✅ Check complete, no files needed formatting changes`)
  }
  else {
    console.log(`✨ Formatted ${changedCount} files successfully`)
  }

  if (errorCount > 0) {
    console.log(`⚠️ ${errorCount} files failed to format`)
  }
}

main().catch((error) => {
  console.error('❌ Execution failed:', (error as Error)?.message ?? String(error))
  process.exit(1)
})
