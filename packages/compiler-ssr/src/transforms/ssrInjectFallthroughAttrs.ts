import {
  NodeTransform,
  NodeTypes,
  ElementTypes,
  locStub,
  createSimpleExpression,
  RootNode,
  TemplateChildNode,
  ParentNode,
  findDir,
  isBuiltInType
} from '@vue/compiler-dom'
// 过虑子节点 如果子节点类型为COMMENT 过虑掉
const filterChild = (node: ParentNode) =>
  node.children.filter(n => n.type !== NodeTypes.COMMENT)
// 如果子节点只有一个
const hasSingleChild = (node: ParentNode): boolean =>
  filterChild(node).length === 1
// SSR注入fallthroughAttrs 
export const ssrInjectFallthroughAttrs: NodeTransform = (node, context) => {
  // _attrs is provided as a function argument.
  // mark it as a known identifier so that it doesn't get prefixed by
  // transformExpression.
  // 如果节点类型为根 将ID认证属性指向 1
  if (node.type === NodeTypes.ROOT) {
    context.identifiers._attrs = 1
  }
  // 如果节点类型为元素 与节点标答理不  
  if (
    node.type === NodeTypes.ELEMENT &&
    node.tagType === ElementTypes.COMPONENT &&
    (isBuiltInType(node.tag, 'Transition') ||
      isBuiltInType(node.tag, 'KeepAlive'))
  ) {
    // 获取过虑后的子节点
    const rootChildren = filterChild(context.root)
    if (rootChildren.length === 1 && rootChildren[0] === node) {
      if (hasSingleChild(node)) {
        // 递归
        injectFallthroughAttrs(node.children[0])
      }
      return
    }
  }

  const parent = context.parent
  if (!parent || parent.type !== NodeTypes.ROOT) {
    return
  }
  // 如果节点类型为IF分支与有单个子节点
  if (node.type === NodeTypes.IF_BRANCH && hasSingleChild(node)) {
    // detect cases where the parent v-if is not the only root level node
    let hasEncounteredIf = false
    // 过虑parent中的子节点
    for (const c of filterChild(parent)) {
      if (
        c.type === NodeTypes.IF ||
        (c.type === NodeTypes.ELEMENT && findDir(c, 'if'))
      ) {
        // multiple root v-if
        if (hasEncounteredIf) return
        hasEncounteredIf = true
      } else if (
        // node before v-if
        !hasEncounteredIf ||
        // non else nodes
        !(c.type === NodeTypes.ELEMENT && findDir(c, /else/, true))
      ) {
        return
      }
    }
    injectFallthroughAttrs(node.children[0])
  } else if (hasSingleChild(parent)) {
    injectFallthroughAttrs(node)
  }
}
// 对属性进行编译AST
function injectFallthroughAttrs(node: RootNode | TemplateChildNode) {
  if (
    node.type === NodeTypes.ELEMENT &&
    (node.tagType === ElementTypes.ELEMENT ||
      node.tagType === ElementTypes.COMPONENT) &&
    !findDir(node, 'for')
  ) {
    node.props.push({
      type: NodeTypes.DIRECTIVE,
      name: 'bind',
      arg: undefined,
      exp: createSimpleExpression(`_attrs`, false),
      modifiers: [],
      loc: locStub
    })
  }
}
