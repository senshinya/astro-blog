import { visit } from 'unist-util-visit'

export function rehypeUnwrapImg() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (
        node.tagName === 'p'
        && node.children
        && parent
        && node.children.every(child =>
          child.tagName === 'img'
          || (child.type === 'text' && child.value.trim() === ''),
        )
      ) {

        const imgNodes = node.children.filter(child => child.tagName === 'img')
        if (imgNodes.length > 0) {
          parent.children.splice(index, 1, ...imgNodes)
        }
      }
    })
  }
}
