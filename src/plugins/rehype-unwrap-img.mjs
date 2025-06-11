import { visit } from 'unist-util-visit'

export function rehypeUnwrapImg() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'p') {
        return
      }
      if (!node.children?.length) {
        return
      }
      if (!parent) {
        return
      }

      const imgNodes = []

      for (const child of node.children) {
        if (child.tagName === 'img') {
          imgNodes.push(child)
        }
        else if (child.type !== 'text' || child.value.trim() !== '') {
          return
        }
      }

      if (imgNodes.length > 0) {
        parent.children.splice(index, 1, ...imgNodes)
      }
    })
  }
}
