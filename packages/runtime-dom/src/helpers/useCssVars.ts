import {
  getCurrentInstance,
  warn,
  VNode,
  Fragment,
  Static,
  watchPostEffect,
  onMounted,
  onUnmounted
} from '@vue/runtime-core'
import { ShapeFlags } from '@vue/shared'

/**
 * Runtime helper for SFC's CSS variable injection feature.
 * @private
 */

// 使用CSSVAR
export function useCssVars(getter: (ctx: any) => Record<string, string>) {
  if (!__BROWSER__ && !__TEST__) return
  // 获取上下文对象
  const instance = getCurrentInstance()
  /* istanbul ignore next */
  // 如果没有上下文对象返回并抛出警告
  if (!instance) {
    __DEV__ &&
      warn(`useCssVars is called without current active component instance.`)
    return
  }
  // 更新 teleports 
  const updateTeleports = (instance.ut = (vars = getter(instance.proxy)) => {
    Array.from(
      document.querySelectorAll(`[data-v-owner="${instance.uid}"]`)
    ).forEach(node => setVarsOnNode(node, vars))
  })
  // 设置声名
  const setVars = () => {
    // 获取声名
    const vars = getter(instance.proxy)
    // 设置声名监听节点
    setVarsOnVNode(instance.subTree, vars)
    // 更新 teleports 
    updateTeleports(vars)
  }
  // 监听副作用
  watchPostEffect(setVars)
  // 挂载方法执行
  onMounted(() => {
    // 观查DOM如果有变化执行setVars方法
    const ob = new MutationObserver(setVars)
    // 如果节点有变化
    ob.observe(instance.subTree.el!.parentNode, { childList: true })
    // 卸载方法
    onUnmounted(() => ob.disconnect())
  })
}
// 设置声名监听节点
function setVarsOnVNode(vnode: VNode, vars: Record<string, string>) {
  if (__FEATURE_SUSPENSE__ && vnode.shapeFlag & ShapeFlags.SUSPENSE) {
    const suspense = vnode.suspense!
    vnode = suspense.activeBranch!
    if (suspense.pendingBranch && !suspense.isHydrating) {
      // 悬挂副作用压入方法
      suspense.effects.push(() => {
        // 递归
        setVarsOnVNode(suspense.activeBranch!, vars)
      })
    }
  }

  // drill down HOCs until it's a non-component vnode 如果节点组件为真 节点指向组件子节点
  while (vnode.component) {
    vnode = vnode.component.subTree
  }
  // 如果节点 是元素
  if (vnode.shapeFlag & ShapeFlags.ELEMENT && vnode.el) {
    // 设置声名中是否有vars的变量
    setVarsOnNode(vnode.el as Node, vars)
    // 如果类型为代码片段 
  } else if (vnode.type === Fragment) {
    // 循环节点设置声名监听的节点
    ;(vnode.children as VNode[]).forEach(c => setVarsOnVNode(c, vars))
  } else if (vnode.type === Static) {
    let { el, anchor } = vnode
    // 如果元素为真
    while (el) {
      // 设置声名的监听节点
      setVarsOnNode(el as Node, vars)
      if (el === anchor) break
      el = el.nextSibling
    }
  }
}
// 设置声名的监听节点
function setVarsOnNode(el: Node, vars: Record<string, string>) {
  if (el.nodeType === 1) {
    const style = (el as HTMLElement).style
    // 循环声名 key
    for (const key in vars) {
      // 样式对象设置属笥 00
      style.setProperty(`--${key}`, vars[key])
    }
  }
}
