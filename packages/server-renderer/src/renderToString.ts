import {
  App,
  createApp,
  createVNode,
  ssrContextKey,
  ssrUtils,
  VNode
} from 'vue'
import { isPromise, isString } from '@vue/shared'
import { SSRContext, renderComponentVNode, SSRBuffer } from './render'
// 判断是节点
const { isVNode } = ssrUtils
// 展开缓冲区
async function unrollBuffer(buffer: SSRBuffer): Promise<string> {
  // 如果buffer有异步
  if (buffer.hasAsync) {
    let ret = ''
    // 循环buffer长度
    for (let i = 0; i < buffer.length; i++) {
      let item = buffer[i]
      // 如果item是promise 等待执行
      if (isPromise(item)) {
        item = await item
      }
      // 如果是字符串拼接
      if (isString(item)) {
        ret += item
      } else {
        // 否则递归
        ret += await unrollBuffer(item)
      }
    }
    return ret
  } else {
    // sync buffer can be more efficiently unrolled without unnecessary await
    // ticks 展示缓冲异步
    return unrollBufferSync(buffer)
  }
}
// 展开缓冲异步
function unrollBufferSync(buffer: SSRBuffer): string {
  let ret = ''
  for (let i = 0; i < buffer.length; i++) {
    let item = buffer[i]
    // 如要buffer是字符串拼接否则递归
    if (isString(item)) {
      ret += item
    } else {
      // since this is a sync buffer, child buffers are never promises
      ret += unrollBufferSync(item as SSRBuffer)
    }
  }
  return ret
}

// 渲染到字符串
export async function renderToString(
  input: App | VNode,
  context: SSRContext = {}
): Promise<string> {
  // 如果输入的是节点
  if (isVNode(input)) {
    // raw vnode, wrap with app (for context) 返回渲染字符串
    return renderToString(createApp({ render: () => input }), context)
  }

  // rendering an app 创建节点 传入组件与属性
  const vnode = createVNode(input._component, input._props)
  // 获取上下文对象指向
  vnode.appContext = input._context
  // provide the ssr context to the tree 输入浪迹天涯一入SSR内容的键与上下文对象
  input.provide(ssrContextKey, context)
  // 渲染组件节点
  const buffer = await renderComponentVNode(vnode)
  // 展开缓冲
  const result = await unrollBuffer(buffer as SSRBuffer)
  // 解析移动内容
  await resolveTeleports(context)
  // 如果监听手动为真
  if (context.__watcherHandles) {
    // 循环解除监听并执行
    for (const unwatch of context.__watcherHandles) {
      unwatch()
    }
  }
  // 返回值
  return result
}

export async function resolveTeleports(context: SSRContext) {
  if (context.__teleportBuffers) {
    context.teleports = context.teleports || {}
    for (const key in context.__teleportBuffers) {
      // note: it's OK to await sequentially here because the Promises were
      // created eagerly in parallel. 获取展开的缓冲
      context.teleports[key] = await unrollBuffer(
        await Promise.all([context.__teleportBuffers[key]])
      )
    }
  }
}
