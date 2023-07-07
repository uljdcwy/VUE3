import {
  NodeTransform,
  NodeTypes,
  ElementTypes,
  locStub,
  createSimpleExpression,
  RootNode,
  TemplateChildNode,
  findDir,
  isBuiltInType
} from '@vue/compiler-dom'
// SSR 注入CSS
export const ssrInjectCssVars: NodeTransform = (node, context) => {
  if (!context.ssrCssVars) {
    return
  }

  // _cssVars is initialized once per render function
  // the code is injected in ssrCodegenTransform when creating the
  // ssr transform context
  // 如果节点类型为 ROOT
  if (node.type === NodeTypes.ROOT) {
    context.identifiers._cssVars = 1
  }
  // 获取父元素
  const parent = context.parent
  // 如果没有父元素或都父元素类型不为ROOT 返回
  if (!parent || parent.type !== NodeTypes.ROOT) {
    return
  }
  // 如果节点类型为 IF 分支
  if (node.type === NodeTypes.IF_BRANCH) {
    // 循环调用injectCssVars  
    for (const child of node.children) {
      injectCssVars(child)
    }
  } else {
    injectCssVars(node)
  }
}
// 注入CSS声名
function injectCssVars(node: RootNode | TemplateChildNode) {
  // 如果节点类型为 元素 与节点标签类型为 元素或者为组件 与没有for
  if (
    node.type === NodeTypes.ELEMENT &&
    (node.tagType === ElementTypes.ELEMENT ||
      node.tagType === ElementTypes.COMPONENT) &&
    !findDir(node, 'for')
  ) {
    // 如果是built类型
    if (isBuiltInType(node.tag, 'Suspense')) {
      // 循环子节点
      for (const child of node.children) {
        // 如果子节点类型为元素与子节点标签类型为TEMPLATE
        if (
          child.type === NodeTypes.ELEMENT &&
          child.tagType === ElementTypes.TEMPLATE
        ) {
          // suspense slot
          // 子节点循环递归
          child.children.forEach(injectCssVars)
        } else {
          // 递归调用
          injectCssVars(child)
        }
      }
    } else {
      // 节点属性中压入值
      node.props.push({
        type: NodeTypes.DIRECTIVE,
        name: 'bind',
        arg: undefined,
        exp: createSimpleExpression(`_cssVars`, false),
        modifiers: [],
        loc: locStub
      })
    }
  }
}
