/**
 * Project: https://github.com/huacnlee/autocorrect
 * Format posts by fixing spaces and punctuations in CJK text
 * Usage: pnpm format-posts
 */
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { format } from 'autocorrect-node'
import fg from 'fast-glob'

function splitContent(content: string) {
  const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n([\s\S]*)$/m)
  if (match) {
    return {
      frontmatter: match[1],
      body: match[2],
      hasFrontmatter: true,
    }
  }
  return {
    frontmatter: '',
    body: content,
    hasFrontmatter: false,
  }
}

async function main() {
  const files = await fg(['src/content/**/*.{md,mdx}'])
  console.log(`🔍 ${files.length} Markdown files found`)

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

      if (content !== newContent) {
        await writeFile(file, newContent, 'utf8')
        console.log(`✅ ${file}`)
        changedCount++
      }
    }
    catch (error) {
      console.error(`❌ ${file}: ${error instanceof Error ? error.message : error}`)
      errorCount++
    }
  }

  console.log(`\n${changedCount > 0
    ? `✨ Formatted ${changedCount} files successfully`
    : `✅ Check complete, no files needed formatting changes`}`)

  if (errorCount > 0) {
    console.log(`⚠️ ${errorCount} files failed to format`)
  }
}

main().catch((error) => {
  console.error('❌ Execution failed:', error)
  process.exit(1)
})
