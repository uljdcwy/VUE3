/* eslint-disable no-restricted-globals */
import {
  ConcreteComponent,
  ComponentInternalInstance,
  ComponentOptions,
  InternalRenderFunction,
  ClassComponent,
  isClassComponent
} from './component'
import { queueJob, queuePostFlushCb } from './scheduler'
import { extend, getGlobalThis } from '@vue/shared'

type HMRComponent = ComponentOptions | ClassComponent

export let isHmrUpdating = false

export const hmrDirtyComponents = new Set<ConcreteComponent>()

export interface HMRRuntime {
  createRecord: typeof createRecord
  rerender: typeof rerender
  reload: typeof reload
}

// Expose the HMR runtime on the global object
// This makes it entirely tree-shakable without polluting the exports and makes
// it easier to be used in toolings like vue-loader
// Note: for a component to be eligible for HMR it also needs the __hmrId option
// to be set so that its instances can be registered / removed.
// 如果是开发环境
if (__DEV__) {
  // 获取全局的this对象，VUE热运行指向对象
  getGlobalThis().__VUE_HMR_RUNTIME__ = {
    createRecord: tryWrap(createRecord),
    rerender: tryWrap(rerender),
    reload: tryWrap(reload)
  } as HMRRuntime
}
// 新建内存地址
const map: Map<
  string,
  {
    // the initial component definition is recorded on import - this allows us
    // to apply hot updates to the component even when there are no actively
    // rendered instance.
    initialDef: ComponentOptions
    instances: Set<ComponentInternalInstance>
  }
> = new Map()
// 注册热替换
export function registerHMR(instance: ComponentInternalInstance) {
  const id = instance.type.__hmrId!
  // 获取记录
  let record = map.get(id)
  // 如果不存在创建
  if (!record) {
    createRecord(id, instance.type as HMRComponent)
    record = map.get(id)!
  }
  // 在记录的上下文对象列表中添加上下文对象
  record.instances.add(instance)
}
// 解除注册
export function unregisterHMR(instance: ComponentInternalInstance) {
  map.get(instance.type.__hmrId!)!.instances.delete(instance)
}
// 创建记录
function createRecord(id: string, initialDef: HMRComponent): boolean {
  if (map.has(id)) {
    return false
  }
  map.set(id, {
    initialDef: normalizeClassComponent(initialDef),
    instances: new Set()
  })
  return true
}
// 格式化组件
function normalizeClassComponent(component: HMRComponent): ComponentOptions {
  // 返回类组件
  return isClassComponent(component) ? component.__vccOpts : component
}
// 渲染方法
function rerender(id: string, newRender?: Function) {
  const record = map.get(id)
  if (!record) {
    return
  }

  // update initial record (for not-yet-rendered component)
  record.initialDef.render = newRender

  // Create a snapshot which avoids the set being mutated during updates
  ;[...record.instances].forEach(instance => {
    if (newRender) {
      instance.render = newRender as InternalRenderFunction
      normalizeClassComponent(instance.type as HMRComponent).render = newRender
    }
    instance.renderCache = []
    // this flag forces child components with slot content to update
    isHmrUpdating = true
    instance.update()
    isHmrUpdating = false
  })
}
// 重加载
function reload(id: string, newComp: HMRComponent) {
  const record = map.get(id)
  if (!record) return
  // 格式化类组件
  newComp = normalizeClassComponent(newComp)
  // update initial def (for not-yet-rendered components)
  // 更新组件DEF
  updateComponentDef(record.initialDef, newComp)

  // create a snapshot which avoids the set being mutated during updates
  const instances = [...record.instances]
  // 循环上下文对象列表
  for (const instance of instances) {
    // 旧组件，指向格式化类的组件
    const oldComp = normalizeClassComponent(instance.type as HMRComponent)

    if (!hmrDirtyComponents.has(oldComp)) {
      // 1. Update existing comp definition to match new one
      if (oldComp !== record.initialDef) {
        // 更新组件DEF
        updateComponentDef(oldComp, newComp)
      }
      // 2. mark definition dirty. This forces the renderer to replace the
      // component on patch.
      // 热目录组件添加旧组件
      hmrDirtyComponents.add(oldComp)
    }

    // 3. invalidate options resolution cache
    instance.appContext.propsCache.delete(instance.type as any)
    instance.appContext.emitsCache.delete(instance.type as any)
    instance.appContext.optionsCache.delete(instance.type as any)

    // 4. actually update
    // 上下文对象重载
    if (instance.ceReload) {
      // custom element
      hmrDirtyComponents.add(oldComp)
      instance.ceReload((newComp as any).styles)
      hmrDirtyComponents.delete(oldComp)
    } else if (instance.parent) {
      // 4. Force the parent instance to re-render. This will cause all updated
      // components to be unmounted and re-mounted. Queue the update so that we
      // don't end up forcing the same parent to re-render multiple times.
      // 调度器内容
      queueJob(instance.parent.update)
    } else if (instance.appContext.reload) {
      // root instance mounted via createApp() has a reload method
      // 上下语文对象中的APP内容重载
      instance.appContext.reload()
    } else if (typeof window !== 'undefined') {
      // root instance inside tree created via raw render(). Force reload.
      // URL重载
      window.location.reload()
    } else {
      console.warn(
        '[HMR] Root or manually mounted instance modified. Full reload required.'
      )
    }
  }

  // 5. make sure to cleanup dirty hmr components after update
  // 队列POST回调
  queuePostFlushCb(() => {
    for (const instance of instances) {
      hmrDirtyComponents.delete(
        normalizeClassComponent(instance.type as HMRComponent)
      )
    }
  })
}
// 更新组件DEF
function updateComponentDef(
  oldComp: ComponentOptions,
  newComp: ComponentOptions
) {
  extend(oldComp, newComp)
  for (const key in oldComp) {
    if (key !== '__file' && !(key in newComp)) {
      delete oldComp[key]
    }
  }
}
// 尝试警告
function tryWrap(fn: (id: string, arg: any) => any): Function {
  return (id: string, arg: any) => {
    try {
      return fn(id, arg)
    } catch (e: any) {
      console.error(e)
      console.warn(
        `[HMR] Something went wrong during Vue component hot-reload. ` +
          `Full reload required.`
      )
    }
  }
}
