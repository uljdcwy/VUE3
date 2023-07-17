import {
  AttributeNode,
  buildProps,
  ComponentNode,
  createCallExpression,
  DirectiveNode,
  findProp,
  JSChildNode,
  NodeTypes,
  TransformContext
} from '@vue/compiler-dom'
import { SSR_RENDER_ATTRS } from '../runtimeHelpers'
import { processChildren, SSRTransformContext } from '../ssrCodegenTransform'
import { buildSSRProps } from './ssrTransformElement'

const wipMap = new WeakMap<ComponentNode, WIPEntry>()

interface WIPEntry {
  tag: AttributeNode | DirectiveNode
  propsExp: string | JSChildNode | null
}

// phase 1: build props
// 转换过度组
export function ssrTransformTransitionGroup(
  node: ComponentNode,
  context: TransformContext
) {
  return () => {
    // 查找属性tag
    const tag = findProp(node, 'tag')
    if (tag) {
      // 过虑掉属性 为 tage的属性
      const otherProps = node.props.filter(p => p !== tag)
      // 解构指仅与属性
      const { props, directives } = buildProps(
        node,
        context,
        otherProps,
        true /* isComponent */,
        false /* isDynamicComponent */,
        true /* ssr (skip event listeners) */
      )
      let propsExp = null
      // 如果属性或者指令为真
      if (props || directives.length) {
        // 创建表达式
        propsExp = createCallExpression(context.helper(SSR_RENDER_ATTRS), [
          buildSSRProps(props, directives, context)
        ])
      }
      // wipMap设置 node指向 tag 与属性表达式的对象
      wipMap.set(node, {
        tag,
        propsExp
      })
    }
  }
}

// phase 2: process children
// SSR 流程转换组
export function ssrProcessTransitionGroup(
  node: ComponentNode,
  context: SSRTransformContext
) {
  // 获取节点入口
  const entry = wipMap.get(node)
  if (entry) {
    // 解构标与属性表达式
    const { tag, propsExp } = entry
    // 如果标签类型为指令
    if (tag.type === NodeTypes.DIRECTIVE) {
      // dynamic :tag
      // 上下文对象中压入字符串部分
      context.pushStringPart(`<`)
      // 压入标标答达式部分
      context.pushStringPart(tag.exp!)
      if (propsExp) {
        // 压入属性表达式部分
        context.pushStringPart(propsExp)
      }
      // 压入结束
      context.pushStringPart(`>`)

      processChildren(
        node,
        context,
        false,
        /**
         * TransitionGroup has the special runtime behavior of flattening and
         * concatenating all children into a single fragment (in order for them to
         * be patched using the same key map) so we need to account for that here
         * by disabling nested fragment wrappers from being generated.
         */
        true
      )
      context.pushStringPart(`</`)
      context.pushStringPart(tag.exp!)
      context.pushStringPart(`>`)
    } else {
      // static tag
      context.pushStringPart(`<${tag.value!.content}`)
      if (propsExp) {
        context.pushStringPart(propsExp)
      }
      context.pushStringPart(`>`)
      processChildren(node, context, false, true)
      context.pushStringPart(`</${tag.value!.content}>`)
    }
  } else {
    // fragment
    processChildren(node, context, true, true)
  }
}
