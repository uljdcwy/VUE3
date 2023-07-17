import {
  ComponentNode,
  findProp,
  NodeTypes,
  createSimpleExpression,
  createFunctionExpression,
  createCallExpression,
  ExpressionNode
} from '@vue/compiler-dom'
import {
  SSRTransformContext,
  processChildrenAsStatement
} from '../ssrCodegenTransform'
import { createSSRCompilerError, SSRErrorCodes } from '../errors'
import { SSR_RENDER_TELEPORT } from '../runtimeHelpers'

// Note: this is a 2nd-pass codegen transform.
// 转换编码可移动DOM块
export function ssrProcessTeleport(
  node: ComponentNode,
  context: SSRTransformContext
) {
  // 查找属性to
  const targetProp = findProp(node, 'to')
  // 没有TO位置抛出错误
  if (!targetProp) {
    context.onError(
      createSSRCompilerError(SSRErrorCodes.X_SSR_NO_TELEPORT_TARGET, node.loc)
    )
    return
  }

  let target: ExpressionNode | undefined
  // 属性类型为属性target指向创建的表达式
  if (targetProp.type === NodeTypes.ATTRIBUTE) {
    target =
      targetProp.value && createSimpleExpression(targetProp.value.content, true)
  } else {
    target = targetProp.exp
  }
  if (!target) {
    context.onError(
      createSSRCompilerError(
        SSRErrorCodes.X_SSR_NO_TELEPORT_TARGET,
        targetProp.loc
      )
    )
    return
  }
  // 查找属性disabled 
  const disabledProp = findProp(node, 'disabled', false, true /* allow empty */)
  // 禁用状态
  const disabled = disabledProp
    ? disabledProp.type === NodeTypes.ATTRIBUTE
      ? `true`
      : disabledProp.exp || `false`
    : `false`
  // 创建函数表达式
  const contentRenderFn = createFunctionExpression(
    [`_push`],
    undefined, // Body is added later
    true, // newline
    false, // isSlot
    node.loc
  )
  // 子语句
  contentRenderFn.body = processChildrenAsStatement(node, context)
  // 上下文对象中压入语句
  context.pushStatement(
    createCallExpression(context.helper(SSR_RENDER_TELEPORT), [
      `_push`,
      contentRenderFn,
      target,
      disabled,
      `_parent`
    ])
  )
}
