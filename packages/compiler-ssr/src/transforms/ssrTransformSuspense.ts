import {
  ComponentNode,
  TransformContext,
  buildSlots,
  createFunctionExpression,
  FunctionExpression,
  TemplateChildNode,
  createCallExpression,
  SlotsExpression
} from '@vue/compiler-dom'
import {
  SSRTransformContext,
  processChildrenAsStatement
} from '../ssrCodegenTransform'
import { SSR_RENDER_SUSPENSE } from '../runtimeHelpers'

const wipMap = new WeakMap<ComponentNode, WIPEntry>()

interface WIPEntry {
  slotsExp: SlotsExpression
  wipSlots: Array<{
    fn: FunctionExpression
    children: TemplateChildNode[]
  }>
}

// phase 1
// SSR 创建一个闭包存丰节点与上下文对象，并返回函数
export function ssrTransformSuspense(
  node: ComponentNode,
  context: TransformContext
) {
  return () => {
    // 如果有子节喽
    if (node.children.length) {
      const wipEntry: WIPEntry = {
        slotsExp: null!, // to be immediately set
        wipSlots: []
      }
      // 弱引用中设置节点键指向 入口
      wipMap.set(node, wipEntry)
      // 入口slot表达式为构建的slot 
      wipEntry.slotsExp = buildSlots(node, context, (_props, children, loc) => {
        // 创建函数表达式
        const fn = createFunctionExpression(
          [],
          undefined, // no return, assign body later
          true, // newline
          false, // suspense slots are not treated as normal slots
          loc
        )
        // 入口的wipSlots 压入函数与子元素
        wipEntry.wipSlots.push({
          fn,
          children
        })
        return fn
      }).slots
    }
  }
}

// phase 2
// 进程悬念
export function ssrProcessSuspense(
  node: ComponentNode,
  context: SSRTransformContext
) {
  // complete wip slots with ssr code
  // 获取节点对应的value
  const wipEntry = wipMap.get(node)
  if (!wipEntry) {
    return
  }
  // 解构slot表达式与wipSlot
  const { slotsExp, wipSlots } = wipEntry
  // 循环SLOT 
  for (let i = 0; i < wipSlots.length; i++) {
    const slot = wipSlots[i]
    // 处理子元素声名
    slot.fn.body = processChildrenAsStatement(slot, context)
  }
  // _push(ssrRenderSuspense(slots))
  // 上下文对象中的 声名压入创建的表达式
  context.pushStatement(
    createCallExpression(context.helper(SSR_RENDER_SUSPENSE), [
      `_push`,
      slotsExp
    ])
  )
}
