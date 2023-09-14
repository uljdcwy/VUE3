import { NodeTransform, NodeTypes, ElementTypes } from '@vue/compiler-core'
import { DOMErrorCodes, createDOMCompilerError } from '../errors'
// 忽略副作用的标答
export const ignoreSideEffectTags: NodeTransform = (node, context) => {
  // 如果是元素与是script或者style 在上下文对象中移除节点
  if (
    node.type === NodeTypes.ELEMENT &&
    node.tagType === ElementTypes.ELEMENT &&
    (node.tag === 'script' || node.tag === 'style')
  ) {
    __DEV__ &&
      context.onError(
        createDOMCompilerError(
          DOMErrorCodes.X_IGNORED_SIDE_EFFECT_TAG,
          node.loc
        )
      )
    context.removeNode()
  }
}
