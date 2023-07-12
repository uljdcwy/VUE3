import {
  NodeTransform,
  isSlotOutlet,
  processSlotOutlet,
  createCallExpression,
  SlotOutletNode,
  createFunctionExpression,
  NodeTypes,
  ElementTypes,
  resolveComponentType,
  TRANSITION
} from '@vue/compiler-dom'
import { SSR_RENDER_SLOT, SSR_RENDER_SLOT_INNER } from '../runtimeHelpers'
import {
  SSRTransformContext,
  processChildrenAsStatement
} from '../ssrCodegenTransform'
// SSR 转换 插糟输入的声名
export const ssrTransformSlotOutlet: NodeTransform = (node, context) => {
  // 如果节点是插糟
  if (isSlotOutlet(node)) {
    // 解构slot 的名称与属性
    const { slotName, slotProps } = processSlotOutlet(node, context)

    const args = [
      `_ctx.$slots`,
      slotName,
      slotProps || `{}`,
      // fallback content placeholder. will be replaced in the process phase
      `null`,
      `_push`,
      `_parent`
    ]

    // inject slot scope id if current template uses :slotted
    // 上下文对象的作用域ID与slot不为false
    if (context.scopeId && context.slotted !== false) {
      // 压入作用域id
      args.push(`"${context.scopeId}-s"`)
    }

    let method = SSR_RENDER_SLOT

    // #3989
    // check if this is a single slot inside a transition wrapper - since
    // transition will unwrap the slot fragment into a single vnode at runtime,
    // we need to avoid rendering the slot as a fragment.
    const parent = context.parent
    if (
      parent &&
      parent.type === NodeTypes.ELEMENT &&
      parent.tagType === ElementTypes.COMPONENT &&
      resolveComponentType(parent, context, true) === TRANSITION &&
      parent.children.filter(c => c.type === NodeTypes.ELEMENT).length === 1
    ) {
      method = SSR_RENDER_SLOT_INNER
      if (!(context.scopeId && context.slotted !== false)) {
        args.push('null')
      }
      args.push('true')
    }
    // 节点的SSR编码内容指向创建的表达式
    node.ssrCodegenNode = createCallExpression(context.helper(method), args)
  }
}
// SSR 插糟输出声名
export function ssrProcessSlotOutlet(
  node: SlotOutletNode,
  context: SSRTransformContext
) {
  const renderCall = node.ssrCodegenNode!

  // has fallback content
  // 如果子节点为真
  if (node.children.length) {
    // 创建空的函数表达式
    const fallbackRenderFn = createFunctionExpression([])
    // 函数表达式内容反映向返回内容
    fallbackRenderFn.body = processChildrenAsStatement(node, context)
    // _renderSlot(slots, name, props, fallback, ...)
    // 渲染可执行参数的第三个指向函数表达式
    renderCall.arguments[3] = fallbackRenderFn
  }

  // Forwarded <slot/>. Merge slot scope ids
  // 上下文对象的作用域ID为真时
  if (context.withSlotScopeId) {
    const slotScopeId = renderCall.arguments[6]
    renderCall.arguments[6] = slotScopeId
      ? `${slotScopeId as string} + _scopeId`
      : `_scopeId`
  }
   // 上下文对象中压入SSR节点编码
  context.pushStatement(node.ssrCodegenNode!)
}
