import { visit } from 'unist-util-visit'

export function rehypeImageProcessor() {
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

      // Convert single image to figure
      if (imgToFigure(node)) {
        return
      }

      // Unwrap images from paragraph
      unwrapImages(node, index, parent)
    })
  }
}

function imgToFigure(node) {
  // Only process paragraphs with single image
  if (node.children.length !== 1) {
    return false
  }

  const imgNode = node.children[0]
  if (imgNode?.tagName !== 'img') {
    return false
  }

  // Skip images without alt text or with underscore prefix
  const altText = imgNode.properties?.alt
  if (!altText || altText.startsWith('_')) {
    return false
  }

  // Convert paragraph to figure with caption
  node.tagName = 'figure'
  node.children = [imgNode, createFigcaption(altText)]
  return true
}

function unwrapImages(node, index, parent) {
  const imgNodes = []

  // Collect images, skip if non-image non-whitespace content found
  for (const child of node.children) {
    if (child.tagName === 'img') {
      imgNodes.push(child)
    }
    else if (child.type !== 'text' || child.value.trim() !== '') {
      return
    }
  }

  // Replace paragraph with unwrapped images
  if (imgNodes.length > 0) {
    parent.children.splice(index, 1, ...imgNodes)
  }
}

function createFigcaption(text) {
  return {
    type: 'element',
    tagName: 'figcaption',
    properties: {},
    children: [{ type: 'text', value: text }],
  }
}
