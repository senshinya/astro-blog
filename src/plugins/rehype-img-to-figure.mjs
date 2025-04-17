import { visit } from 'unist-util-visit'

export function rehypeImgToFigure() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (
        node.tagName === 'p'
        && node.children
        && node.children.length === 1
        && node.children[0].tagName === 'img'
        && node.children[0].properties.alt
        && !node.children[0].properties.alt.startsWith('_')
      ) {
        const child = node.children[0]
        const altText = child.properties.alt

        node.tagName = 'figure'
        node.children = [
          child,
          {
            type: 'element',
            tagName: 'figcaption',
            properties: {},
            children: [{ type: 'text', value: altText }],
          },
        ]
      }
    })
  }
}
