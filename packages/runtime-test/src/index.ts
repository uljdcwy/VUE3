import {
  createRenderer,
  VNode,
  RootRenderFunction,
  CreateAppFunction
} from '@vue/runtime-core'
import { nodeOps, TestElement } from './nodeOps'
import { patchProp } from './patchProp'
import { serializeInner } from './serialize'
import { extend } from '@vue/shared'
// 创建渲染传入扩展更新属笥，节点选项
const { render: baseRender, createApp: baseCreateApp } = createRenderer(
  extend({ patchProp }, nodeOps)
)
// 基本渲染指向
export const render = baseRender as RootRenderFunction<TestElement>
// 创建APP方法导出
export const createApp = baseCreateApp as CreateAppFunction<TestElement>

// convenience for one-off render validations 渲染到字符串
export function renderToString(vnode: VNode) {
  // 创建根元素
  const root = nodeOps.createElement('div')
  // 渲染节点
  render(vnode, root)
  // 序列化内部根元素
  return serializeInner(root)
}

export * from './triggerEvent'
export * from './serialize'
export * from './nodeOps'
export * from '@vue/runtime-core'
