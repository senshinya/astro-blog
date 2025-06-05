import { visit } from 'unist-util-visit'

export function rehypeImgToFigure() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'p')
        return
      if (node.children?.length !== 1)
        return

      const imgNode = node.children[0]
      if (imgNode?.tagName !== 'img')
        return

      const altText = imgNode.properties?.alt
      if (!altText)
        return
      if (altText.startsWith('_'))
        return

      node.tagName = 'figure'
      node.children = [
        imgNode,
        {
          type: 'element',
          tagName: 'figcaption',
          properties: {},
          children: [{ type: 'text', value: altText }],
        },
      ]
    })
  }
}
