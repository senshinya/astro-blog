import { SKIP, visit } from 'unist-util-visit';

export function rehypeCodeCollapse(options = {}) {
    const { maxLines = 50 } = options;

    return (tree) => {
        visit(tree, 'element', (node, index, parent) => {
            if (node.tagName === 'pre' &&
                node.children?.[0]?.tagName === 'code') {

                const codeNode = node.children[0];
                const wrapperId = `toggle-${Math.random().toString(36).substr(2, 9)}`;
                if (codeNode.children.length > maxLines) {
                    // 克隆原始代码节点结构，只截取前 maxLines 行
                    const previewCodeNode = {
                        type: 'element',
                        tagName: 'code',
                        properties: codeNode.properties,
                        children: codeNode.children.slice(0, maxLines)
                    };

                    const wrapper = {
                        type: 'element',
                        tagName: 'div',
                        properties: {
                            className: ['code-collapse-wrapper']
                        },
                        children: [
                            // 隐藏的 checkbox
                            {
                                type: 'element',
                                tagName: 'input',
                                properties: {
                                    type: 'checkbox',
                                    id: wrapperId,
                                    className: ['code-collapse-toggle'],
                                    style: 'display: none;'
                                },
                                children: []
                            },
                            // 预览区域
                            {
                                type: 'element',
                                tagName: 'div',
                                properties: {
                                    className: ['code-collapse-preview']
                                },
                                children: [
                                    {
                                        type: 'element',
                                        tagName: 'pre',
                                        properties: {
                                            ...node.properties,
                                            className: [...(node.properties?.className || []), 'code-preview']
                                        },
                                        children: [previewCodeNode]
                                    },
                                    {
                                        type: 'element',
                                        tagName: 'div',
                                        properties: {
                                            className: ['code-collapse-gradient']
                                        },
                                        children: []
                                    },
                                    // 展开按钮（label）
                                    {
                                        type: 'element',
                                        tagName: 'label',
                                        properties: {
                                            className: ['code-collapse-expand'],
                                            htmlFor: wrapperId
                                        },
                                        children: [
                                            {
                                                type: 'element',
                                                tagName: 'svg',
                                                properties: {
                                                    className: ['code-collapse-icon'],
                                                    width: '24',
                                                    height: '24',
                                                    viewBox: '0 0 24 24',
                                                    fill: 'none',
                                                    stroke: 'currentColor',
                                                    strokeWidth: '2',
                                                    strokeLinecap: 'round',
                                                    strokeLinejoin: 'round'
                                                },
                                                children: [
                                                    {
                                                        type: 'element',
                                                        tagName: 'polyline',
                                                        properties: {
                                                            points: '6,9 12,15 18,9'
                                                        },
                                                        children: []
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            },
                            // 完整代码
                            {
                                type: 'element',
                                tagName: 'div',
                                properties: {
                                    className: ['code-collapse-full']
                                },
                                children: [node]
                            }
                        ]
                    };

                    parent.children[index] = wrapper;
                }
                return SKIP;
            }
        });
    };
}
