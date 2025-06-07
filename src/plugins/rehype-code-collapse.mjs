import { SKIP, visit } from 'unist-util-visit';

export function rehypeCodeCollapse(options = {}) {
    const { maxLines = 50 } = options;

    return (tree) => {
        visit(tree, 'element', (node, index, parent) => {
            if (node.tagName === 'pre' &&
                node.children?.[0]?.tagName === 'code') {

                const codeNode = node.children[0];
                const wrapperId = `toggle-${Math.random().toString(36).substring(2, 9)}`;
                if (codeNode.children.length > maxLines * 2) {
                    // 克隆原始代码节点结构，只截取前 maxLines 行
                    const previewCodeNode = {
                        type: 'element',
                        tagName: 'code',
                        properties: codeNode.properties,
                        children: codeNode.children.slice(0, maxLines * 2)
                    };

                    // 创建展开按钮
                    const expandButton = {
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
                                    width: '32',
                                    height: '24',
                                    viewBox: '0 0 32 24',
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
                                            points: '4,9 12,17 20,9'
                                        },
                                        children: []
                                    }
                                ]
                            }
                        ]
                    };

                    // 创建折叠按钮
                    const collapseButton = {
                        type: 'element',
                        tagName: 'label',
                        properties: {
                            className: ['code-collapse-collapse'],
                            htmlFor: wrapperId
                        },
                        children: [
                            {
                                type: 'element',
                                tagName: 'svg',
                                properties: {
                                    className: ['code-collapse-icon'],
                                    width: '32',
                                    height: '24',
                                    viewBox: '0 0 32 24',
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
                                            points: '20,15 12,7 4,15'
                                        },
                                        children: []
                                    }
                                ]
                            }
                        ]
                    };

                    node.children = [
                        ...node.children,
                        {
                            type: 'element',
                            tagName: 'div',
                            properties: {
                                className: ['code-collapse-collapse-area']
                            },
                            children: [collapseButton]
                        }
                    ];

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
                                    expandButton
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