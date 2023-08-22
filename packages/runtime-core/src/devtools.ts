/* eslint-disable no-restricted-globals */
import { App } from './apiCreateApp'
import { Fragment, Text, Comment, Static } from './vnode'
import { ComponentInternalInstance } from './component'

interface AppRecord {
  id: number
  app: App
  version: string
  types: Record<string, string | Symbol>
}

const enum DevtoolsHooks {
  APP_INIT = 'app:init',
  APP_UNMOUNT = 'app:unmount',
  COMPONENT_UPDATED = 'component:updated',
  COMPONENT_ADDED = 'component:added',
  COMPONENT_REMOVED = 'component:removed',
  COMPONENT_EMIT = 'component:emit',
  PERFORMANCE_START = 'perf:start',
  PERFORMANCE_END = 'perf:end'
}

interface DevtoolsHook {
  enabled?: boolean
  emit: (event: string, ...payload: any[]) => void
  on: (event: string, handler: Function) => void
  once: (event: string, handler: Function) => void
  off: (event: string, handler: Function) => void
  appRecords: AppRecord[]
  /**
   * Added at https://github.com/vuejs/devtools/commit/f2ad51eea789006ab66942e5a27c0f0986a257f9
   * Returns wether the arg was buffered or not
   */
  cleanupBuffer?: (matchArg: unknown) => boolean
}

export let devtools: DevtoolsHook

let buffer: { event: string; args: any[] }[] = []

let devtoolsNotInstalled = false
// emit 事件，在开发环境与开发非安装文件，在BUFFER压入事件内容
function emit(event: string, ...args: any[]) {
  if (devtools) {
    devtools.emit(event, ...args)
  } else if (!devtoolsNotInstalled) {
    buffer.push({ event, args })
  }
}
// 设置开发勾子
export function setDevtoolsHook(hook: DevtoolsHook, target: any) {
  // 开发工具指向勾子
  devtools = hook
  // 如果开发工具为真
  if (devtools) {
    // 启用设置为真
    devtools.enabled = true
    // 循环BUFFER发送EMIT
    buffer.forEach(({ event, args }) => devtools.emit(event, ...args))
    buffer = []
  } else if (
    // handle late devtools injection - only do this if we are in an actual
    // browser environment to avoid the timer handle stalling test runner exit
    // (#4815)
    // 查看WINDOW 不是 未定义
    typeof window !== 'undefined' &&
    // some envs mock window but not fully
    // 与WINDOW元素为真，
    window.HTMLElement &&
    // also exclude jsdom
    // 在浏览器对象中是否有JSDOM
    !window.navigator?.userAgent?.includes('jsdom')
  ) {
    const replay = (target.__VUE_DEVTOOLS_HOOK_REPLAY__ =
      target.__VUE_DEVTOOLS_HOOK_REPLAY__ || [])
    replay.push((newHook: DevtoolsHook) => {
      setDevtoolsHook(newHook, target)
    })
    // clear buffer after 3s - the user probably doesn't have devtools installed
    // at all, and keeping the buffer will cause memory leaks (#4738)
    // 延时清空指向
    setTimeout(() => {
      if (!devtools) {
        target.__VUE_DEVTOOLS_HOOK_REPLAY__ = null
        devtoolsNotInstalled = true
        buffer = []
      }
    }, 3000)
  } else {
    // non-browser env, assume not installed
    devtoolsNotInstalled = true
    buffer = []
  }
}
// 开发工具初始化APP
export function devtoolsInitApp(app: App, version: string) {
  emit(DevtoolsHooks.APP_INIT, app, version, {
    Fragment,
    Text,
    Comment,
    Static
  })
}
// 开发工具卸载APP
export function devtoolsUnmountApp(app: App) {
  emit(DevtoolsHooks.APP_UNMOUNT, app)
}
// 组件添加
export const devtoolsComponentAdded = /*#__PURE__*/ createDevtoolsComponentHook(
  DevtoolsHooks.COMPONENT_ADDED
)
// 组件更新
export const devtoolsComponentUpdated =
  /*#__PURE__*/ createDevtoolsComponentHook(DevtoolsHooks.COMPONENT_UPDATED)
// 组件移除
const _devtoolsComponentRemoved = /*#__PURE__*/ createDevtoolsComponentHook(
  DevtoolsHooks.COMPONENT_REMOVED
)
// 组件移除
export const devtoolsComponentRemoved = (
  component: ComponentInternalInstance
) => {
  if (
    devtools &&
    typeof devtools.cleanupBuffer === 'function' &&
    // remove the component if it wasn't buffered
    !devtools.cleanupBuffer(component)
  ) {
    _devtoolsComponentRemoved(component)
  }
}
// 创建组件勾子
function createDevtoolsComponentHook(hook: DevtoolsHooks) {
  return (component: ComponentInternalInstance) => {
    emit(
      hook,
      component.appContext.app,
      component.uid,
      component.parent ? component.parent.uid : undefined,
      component
    )
  }
}
// 开始性能
export const devtoolsPerfStart = /*#__PURE__*/ createDevtoolsPerformanceHook(
  DevtoolsHooks.PERFORMANCE_START
)
// 结束性能
export const devtoolsPerfEnd = /*#__PURE__*/ createDevtoolsPerformanceHook(
  DevtoolsHooks.PERFORMANCE_END
)
// 创建性能勾子
function createDevtoolsPerformanceHook(hook: DevtoolsHooks) {
  return (component: ComponentInternalInstance, type: string, time: number) => {
    emit(hook, component.appContext.app, component.uid, component, type, time)
  }
}
// 组件事件
export function devtoolsComponentEmit(
  component: ComponentInternalInstance,
  event: string,
  params: any[]
) {
  emit(
    DevtoolsHooks.COMPONENT_EMIT,
    component.appContext.app,
    component,
    event,
    params
  )
}
