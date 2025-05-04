import { visit } from 'unist-util-visit'

const ADMONITION_TYPES = {
  note: 'NOTE',
  tip: 'TIP',
  important: 'IMPORTANT',
  warning: 'WARNING',
  caution: 'CAUTION',
}

const GITHUB_ADMONITION_REGEX = new RegExp(
  `^\\s*\\[!(${Object.values(ADMONITION_TYPES).join('|')})\\]\\s*`,
  'i',
)

export function remarkAdmonitions() {
  return (tree) => {
    // Create an admonition blockquote
    function createAdmonition(node, type, title) {
      const titleSpan = `<span class="admonition-title">${title}</span>`

      node.data = node.data || {}
      node.data.hName = 'blockquote'
      node.data.hProperties = {
        className: `admonition-${type}`,
      }

      node.children.unshift({
        type: 'html',
        value: titleSpan,
      })
    }

    // Handle :::type syntax
    visit(tree, 'containerDirective', (node) => {
      const type = node.name
      if (!ADMONITION_TYPES[type])
        return

      let title = ADMONITION_TYPES[type]
      const firstChild = node.children?.[0]

      // Use [title] syntax for custom title
      if (firstChild?.data?.directiveLabel) {
        if (firstChild.children?.length) {
          title = firstChild.children
            .map(child => child.type === 'text' ? child.value : '')
            .join('')
            .trim() || title
        }

        node.children.shift()
      }

      createAdmonition(node, type, title)
    })

    // Handle > [!TYPE] syntax
    visit(tree, 'blockquote', (node) => {
      if (!node.children?.length || node.children[0].type !== 'paragraph')
        return

      const paragraph = node.children[0]
      if (!paragraph.children?.length || paragraph.children[0].type !== 'text')
        return

      const textNode = paragraph.children[0]
      const match = textNode.value.match(GITHUB_ADMONITION_REGEX)
      if (!match)
        return

      const type = match[1].toLowerCase()
      const title = ADMONITION_TYPES[type]

      textNode.value = textNode.value.substring(match[0].length)

      createAdmonition(node, type, title)
    })
  }
}
