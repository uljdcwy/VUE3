import {
  isReactive,
  reactive,
  track,
  TrackOpTypes,
  trigger,
  TriggerOpTypes
} from '@vue/reactivity'
import {
  isFunction,
  extend,
  NOOP,
  isArray,
  isObject,
  isString,
  invokeArrayFns
} from '@vue/shared'
import { warn } from '../warning'
import { cloneVNode, createVNode } from '../vnode'
import { RootRenderFunction } from '../renderer'
import {
  App,
  AppConfig,
  AppContext,
  CreateAppFunction,
  Plugin
} from '../apiCreateApp'
import {
  Component,
  ComponentOptions,
  createComponentInstance,
  finishComponentSetup,
  isRuntimeOnly,
  setupComponent
} from '../component'
import {
  RenderFunction,
  mergeOptions,
  internalOptionMergeStrats
} from '../componentOptions'
import { ComponentPublicInstance } from '../componentPublicInstance'
import { devtoolsInitApp, devtoolsUnmountApp } from '../devtools'
import { Directive } from '../directives'
import { nextTick } from '../scheduler'
import { version } from '..'
import {
  installLegacyConfigWarnings,
  installLegacyOptionMergeStrats,
  LegacyConfig
} from './globalConfig'
import { LegacyDirective } from './customDirective'
import {
  warnDeprecation,
  DeprecationTypes,
  assertCompatEnabled,
  configureCompat,
  isCompatEnabled,
  softAssertCompatEnabled
} from './compatConfig'
import { LegacyPublicInstance } from './instance'

/**
 * @deprecated the default `Vue` export has been removed in Vue 3. The type for
 * the default export is provided only for migration purposes. Please use
 * named imports instead - e.g. `import { createApp } from 'vue'`.
 */
export type CompatVue = Pick<App, 'version' | 'component' | 'directive'> & {
  configureCompat: typeof configureCompat

  // no inference here since these types are not meant for actual use - they
  // are merely here to provide type checks for internal implementation and
  // information for migration.
  new (options?: ComponentOptions): LegacyPublicInstance

  version: string
  config: AppConfig & LegacyConfig

  nextTick: typeof nextTick

  use(plugin: Plugin, ...options: any[]): CompatVue
  mixin(mixin: ComponentOptions): CompatVue

  component(name: string): Component | undefined
  component(name: string, component: Component): CompatVue
  directive(name: string): Directive | undefined
  directive(name: string, directive: Directive): CompatVue

  compile(template: string): RenderFunction

  /**
   * @deprecated Vue 3 no longer supports extending constructors.
   */
  extend: (options?: ComponentOptions) => CompatVue
  /**
   * @deprecated Vue 3 no longer needs set() for adding new properties.
   */
  set(target: any, key: string | number | symbol, value: any): void
  /**
   * @deprecated Vue 3 no longer needs delete() for property deletions.
   */
  delete(target: any, key: string | number | symbol): void
  /**
   * @deprecated use `reactive` instead.
   */
  observable: typeof reactive
  /**
   * @deprecated filters have been removed from Vue 3.
   */
  filter(name: string, arg?: any): null
  /**
   * @internal
   */
  cid: number
  /**
   * @internal
   */
  options: ComponentOptions
  /**
   * @internal
   */
  util: any
  /**
   * @internal
   */
  super: CompatVue
}

export let isCopyingConfig = false

// exported only for test
export let singletonApp: App
let singletonCtor: CompatVue

// Legacy global Vue constructor
// 创建兼容VUE
export function createCompatVue(
  // 创建App 元素方法
  createApp: CreateAppFunction<Element>,
  // 创建简单的APP方法
  createSingletonApp: CreateAppFunction<Element>
): CompatVue {
  // 简单的APP指向为创建的简单的APP方法并传入空对象
  singletonApp = createSingletonApp({})
  // VUE函数定义
  const Vue: CompatVue = (singletonCtor = function Vue(
    options: ComponentOptions = {}
  ) {
    // 返回创建的兼容APP
    return createCompatApp(options, Vue)
  } as any)
  // 创建兼容APP方法
  function createCompatApp(options: ComponentOptions = {}, Ctor: any) {
    // // 启用断言兼容
    assertCompatEnabled(DeprecationTypes.GLOBAL_MOUNT, null)
    // 解构data
    const { data } = options
    // 如果 data为真 如果data 不是函数  与软断言启动
    if (
      data &&
      !isFunction(data) &&
      softAssertCompatEnabled(DeprecationTypes.OPTIONS_DATA_FN, null)
    ) {
      // 选项中的data指向 data
      options.data = () => data
    }
    // app为创建的 app
    const app = createApp(options)
    // 如果不为Vue
    if (Ctor !== Vue) {
      // 应用单例原型
      applySingletonPrototype(app, Ctor)
    }
    // 获取VM对象
    const vm = app._createRoot!(options)
    // 如果选项中的el为真返回并挂载
    if (options.el) {
      return (vm as any).$mount(options.el)
    } else {
      // 返回vm
      return vm
    }
  }
  // Vue指向兼容版本
  Vue.version = `2.6.14-compat:${__VERSION__}`
  // VUE全局配置指向APP全局配置
  Vue.config = singletonApp.config
  // VUE的使用方法
  Vue.use = (p, ...options) => {
    if (p && isFunction(p.install)) {
      p.install(Vue as any, ...options)
    } else if (isFunction(p)) {
      p(Vue as any, ...options)
    }
    return Vue
  }
  // VUE混入指向VUE
  Vue.mixin = m => {
    singletonApp.mixin(m)
    return Vue
  }
  // VUE组件组件指向方法返回单个APP挂载
  Vue.component = ((name: string, comp: Component) => {
    if (comp) {
      singletonApp.component(name, comp)
      return Vue
    } else {
      return singletonApp.component(name)
    }
  }) as any
  // VUE指令指向令加载方法
  Vue.directive = ((name: string, dir: Directive | LegacyDirective) => {
    if (dir) {
      singletonApp.directive(name, dir as Directive)
      return Vue
    } else {
      return singletonApp.directive(name)
    }
  }) as any
  // VUE选项中的_base指向VUE
  Vue.options = { _base: Vue }

  let cid = 1
  // VUE的CID指向CID
  Vue.cid = cid

  Vue.nextTick = nextTick
  // 扩展缓存
  const extendCache = new WeakMap()
  // 扩菜Ctor
  function extendCtor(this: any, extendOptions: ComponentOptions = {}) {
    // 断言兼容启用
    assertCompatEnabled(DeprecationTypes.GLOBAL_EXTEND, null)
    // 如果是函数扩展选项
    if (isFunction(extendOptions)) {
      // 扩展选项指向扩展选项中的选项
      extendOptions = extendOptions.options
    }
    // 扩展缓存如果有扩展选项
    if (extendCache.has(extendOptions)) {
      // 返回获取到的缓存
      return extendCache.get(extendOptions)
    }
    // Super超对象的指向
    const Super = this
    // 子VUE对象
    function SubVue(inlineOptions?: ComponentOptions) {
      // 如果在线选项为假 返回创建的兼容APP
      if (!inlineOptions) {
        return createCompatApp(SubVue.options, SubVue)
      } else {
        // 返回创建的兼容APP方法
        return createCompatApp(
          mergeOptions(
            extend({}, SubVue.options),
            inlineOptions,
            internalOptionMergeStrats as any
          ),
          SubVue
        )
      }
    }
    // 获取父对象
    SubVue.super = Super
    // 指向空 源型
    SubVue.prototype = Object.create(Vue.prototype)
    // constructor 指向subVue
    SubVue.prototype.constructor = SubVue

    // clone non-primitive base option values for edge case of mutating
    // extended options
    // 基本合并初始化为空对象
    const mergeBase: any = {}
    // 循环超级方法的选项
    for (const key in Super.options) {
      // 获取值
      const superValue = Super.options[key]
      // 合并方法
      mergeBase[key] = isArray(superValue)
        ? superValue.slice()
        : isObject(superValue)
        ? extend(Object.create(null), superValue)
        : superValue
    }
    // 合并选项
    SubVue.options = mergeOptions(
      mergeBase,
      extendOptions,
      internalOptionMergeStrats as any
    )
    // 基本选项指向
    SubVue.options._base = SubVue
    // 扩展方法指向
    SubVue.extend = extendCtor.bind(SubVue)
    // 混合指向
    SubVue.mixin = Super.mixin
    // use方法指向
    SubVue.use = Super.use
    // cid自增
    SubVue.cid = ++cid
      // 缓存选项
    extendCache.set(extendOptions, SubVue)
    // 返回subVue
    return SubVue
  }
  // VUE扩展 
  Vue.extend = extendCtor.bind(Vue) as any
// Vueset方法
  Vue.set = (target, key, value) => {
    assertCompatEnabled(DeprecationTypes.GLOBAL_SET, null)
    target[key] = value
  }
  // 
  Vue.delete = (target, key) => {
    assertCompatEnabled(DeprecationTypes.GLOBAL_DELETE, null)
    delete target[key]
  }
  // 观查方法
  Vue.observable = (target: any) => {
    assertCompatEnabled(DeprecationTypes.GLOBAL_OBSERVABLE, null)
    return reactive(target)
  }
  // 过滤方法
  Vue.filter = ((name: string, filter?: any) => {
    if (filter) {
      singletonApp.filter!(name, filter)
      return Vue
    } else {
      return singletonApp.filter!(name)
    }
  }) as any

  // internal utils - these are technically internal but some plugins use it.
  // util方法指向
  const util = {
    warn: __DEV__ ? warn : NOOP,
    extend,
    mergeOptions: (parent: any, child: any, vm?: ComponentPublicInstance) =>
      mergeOptions(
        parent,
        child,
        vm ? undefined : (internalOptionMergeStrats as any)
      ),
    defineReactive
  }
  // 设置 get 方法
  Object.defineProperty(Vue, 'util', {
    get() {
      assertCompatEnabled(DeprecationTypes.GLOBAL_PRIVATE_UTIL, null)
      return util
    }
  })
  // 全局兼容指禹
  Vue.configureCompat = configureCompat
  // 返回Vue
  return Vue
}
// 安装 APP兼容属性
export function installAppCompatProperties(
  app: App,
  context: AppContext,
  render: RootRenderFunction<any>
) {
  // 安装 过虑方法
  installFilterMethod(app, context)
  // 安装 旧版本合并略
  installLegacyOptionMergeStrats(app.config)
  // 如果不是简单的APP返回空
  if (!singletonApp) {
    // this is the call of creating the singleton itself so the rest is
    // unnecessary
    return
  }
  // 安装 兼容挂载
  installCompatMount(app, context, render)
  // 安装旧版API
  installLegacyAPIs(app)
  // 就用单例程序突变
  applySingletonAppMutations(app)
  // 如果是开发环境，安装旧版警告
  if (__DEV__) installLegacyConfigWarnings(app.config)
}
// 安装 过虑方法
function installFilterMethod(app: App, context: AppContext) {
  context.filters = {}
  app.filter = (name: string, filter?: Function): any => {
    // 启用断言兼容
    assertCompatEnabled(DeprecationTypes.FILTERS, null)
    if (!filter) {
      return context.filters![name]
    }
    if (__DEV__ && context.filters![name]) {
      warn(`Filter "${name}" has already been registered.`)
    }
    context.filters![name] = filter
    return app
  }
}
  // 安装 旧版API 
function installLegacyAPIs(app: App) {
  // expose global API on app instance for legacy plugins
  Object.defineProperties(app, {
    // so that app.use() can work with legacy plugins that extend prototypes
    prototype: {
      get() {
        __DEV__ && warnDeprecation(DeprecationTypes.GLOBAL_PROTOTYPE, null)
        return app.config.globalProperties
      }
    },
    nextTick: { value: nextTick },
    extend: { value: singletonCtor.extend },
    set: { value: singletonCtor.set },
    delete: { value: singletonCtor.delete },
    observable: { value: singletonCtor.observable },
    util: {
      get() {
        return singletonCtor.util
      }
    }
  })
}
// 应用单例就用程序突变
function applySingletonAppMutations(app: App) {
  // copy over asset registries and deopt flag
  app._context.mixins = [...singletonApp._context.mixins]
  ;['components', 'directives', 'filters'].forEach(key => {
    // @ts-ignore
    app._context[key] = Object.create(singletonApp._context[key])
  })

  // copy over global config mutations
  isCopyingConfig = true
  for (const key in singletonApp.config) {
    if (key === 'isNativeTag') continue
    if (
      isRuntimeOnly() &&
      (key === 'isCustomElement' || key === 'compilerOptions')
    ) {
      continue
    }
    const val = singletonApp.config[key as keyof AppConfig]
    // @ts-ignore
    app.config[key] = isObject(val) ? Object.create(val) : val

    // compat for runtime ignoredElements -> isCustomElement
    if (
      key === 'ignoredElements' &&
      isCompatEnabled(DeprecationTypes.CONFIG_IGNORED_ELEMENTS, null) &&
      !isRuntimeOnly() &&
      isArray(val)
    ) {
      app.config.compilerOptions.isCustomElement = tag => {
        return val.some(v => (isString(v) ? v === tag : v.test(tag)))
      }
    }
  }
  isCopyingConfig = false
  applySingletonPrototype(app, singletonCtor)
}
// 应用单例 原型
function applySingletonPrototype(app: App, Ctor: Function) {
  // copy prototype augmentations as config.globalProperties
  const enabled = isCompatEnabled(DeprecationTypes.GLOBAL_PROTOTYPE, null)
  if (enabled) {
    app.config.globalProperties = Object.create(Ctor.prototype)
  }
  let hasPrototypeAugmentations = false
  const descriptors = Object.getOwnPropertyDescriptors(Ctor.prototype)
  for (const key in descriptors) {
    if (key !== 'constructor') {
      hasPrototypeAugmentations = true
      if (enabled) {
        Object.defineProperty(
          app.config.globalProperties,
          key,
          descriptors[key]
        )
      }
    }
  }
  if (__DEV__ && hasPrototypeAugmentations) {
    warnDeprecation(DeprecationTypes.GLOBAL_PROTOTYPE, null)
  }
}
// 安装 兼容挂载
function installCompatMount(
  app: App,
  context: AppContext,
  render: RootRenderFunction
) {
  let isMounted = false

  /**
   * Vue 2 supports the behavior of creating a component instance but not
   * mounting it, which is no longer possible in Vue 3 - this internal
   * function simulates that behavior.
   */
  // app创建根指向选项
  app._createRoot = options => {
    // 指向app组件
    const component = app._component
    // vNode指向创建的节点
    const vnode = createVNode(component, options.propsData || null)
    // 节点app内容指向上下文对象
    vnode.appContext = context
    // 没有渲染
    const hasNoRender =
      !isFunction(component) && !component.render && !component.template
    const emptyRender = () => {}

    // create root instance
    // 创建根上下文对象
    const instance = createComponentInstance(vnode, null, null)
    // suppress "missing render fn" warning since it can't be determined
    // until $mount is called
    // 如果没有渲染指向空渲染
    if (hasNoRender) {
      instance.render = emptyRender
    }
    // 安装组件
    setupComponent(instance)
    // 节点组件指向上下文对象
    vnode.component = instance
    // 判断兼容根
    vnode.isCompatRoot = true

    // $mount & $destroy
    // these are defined on ctx and picked up by the $mount/$destroy
    // public property getters on the instance proxy.
    // Note: the following assumes DOM environment since the compat build
    // only targets web. It essentially includes logic for app.mount from
    // both runtime-core AND runtime-dom.
    // 上下文对象中的兼容挂载指向
    instance.ctx._compat_mount = (selectorOrEl?: string | Element) => {
      if (isMounted) {
        __DEV__ && warn(`Root instance is already mounted.`)
        return
      }

      let container: Element
      if (typeof selectorOrEl === 'string') {
        // eslint-disable-next-line
        const result = document.querySelector(selectorOrEl)
        if (!result) {
          __DEV__ &&
            warn(
              `Failed to mount root instance: selector "${selectorOrEl}" returned null.`
            )
          return
        }
        container = result
      } else {
        // eslint-disable-next-line
        container = selectorOrEl || document.createElement('div')
      }

      const isSVG = container instanceof SVGElement

      // HMR root reload
      if (__DEV__) {
        context.reload = () => {
          const cloned = cloneVNode(vnode)
          // compat mode will use instance if not reset to null
          cloned.component = null
          render(cloned, container, isSVG)
        }
      }

      // resolve in-DOM template if component did not provide render
      // and no setup/mixin render functions are provided (by checking
      // that the instance is still using the placeholder render fn)
      // 如果没有渲染与渲染为空
      if (hasNoRender && instance.render === emptyRender) {
        // root directives check
        if (__DEV__) {
          for (let i = 0; i < container.attributes.length; i++) {
            const attr = container.attributes[i]
            if (attr.name !== 'v-cloak' && /^(v-|:|@)/.test(attr.name)) {
              warnDeprecation(DeprecationTypes.GLOBAL_MOUNT_CONTAINER, null)
              break
            }
          }
        }
        instance.render = null
        ;(component as ComponentOptions).template = container.innerHTML
        // 完成组件安装
        finishComponentSetup(instance, false, true /* skip options */)
      }

      // clear content before mounting
      container.innerHTML = ''

      // TODO hydration
      // 渲染
      render(vnode, container, isSVG)
      // 如果内容在元素属性中 移除v-cloak 设置属性data-v-app 指向 ''
      if (container instanceof Element) {
        container.removeAttribute('v-cloak')
        container.setAttribute('data-v-app', '')
      }
      // 是挂载指向空
      isMounted = true
      // // 指向内容体
      app._container = container
      // for devtools and telemetry
      ;(container as any).__vue_app__ = app
      // 如果值为真开发初始化APP
      if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
        devtoolsInitApp(app, version)
      }
      // 返回上下文的代理对象
      return instance.proxy!
    }
    // 兼容销毁方法
    instance.ctx._compat_destroy = () => {
      // 如果是挂载
      if (isMounted) {
        // 渲染内容
        render(null, app._container)
        if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
          devtoolsUnmountApp(app)
        }
        delete app._container.__vue_app__
      } else {
        // 解构上下文对象
        const { bum, scope, um } = instance
        // beforeDestroy hooks
        // 
        if (bum) {
          invokeArrayFns(bum)
        }
        // 发送销毁方法
        if (isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)) {
          instance.emit('hook:beforeDestroy')
        }
        // stop effects
        if (scope) {
          scope.stop()
        }
        // unmounted hook
        if (um) {
          // 调用数组方法
          invokeArrayFns(um)
        }
        if (isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)) {
          instance.emit('hook:destroyed')
        }
      }
    }

    return instance.proxy!
  }
}

const methodsToPatch = [
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse'
]

const patched = new WeakSet<object>()
// 定义晌应
function defineReactive(obj: any, key: string, val: any) {
  // it's possible for the original object to be mutated after being defined
  // and expecting reactivity... we are covering it here because this seems to
  // be a bit more common.
  if (isObject(val) && !isReactive(val) && !patched.has(val)) {
    const reactiveVal = reactive(val)
    if (isArray(val)) {
      methodsToPatch.forEach(m => {
        // @ts-ignore
        val[m] = (...args: any[]) => {
          // @ts-ignore
          Array.prototype[m].call(reactiveVal, ...args)
        }
      })
    } else {
      Object.keys(val).forEach(key => {
        try {
          defineReactiveSimple(val, key, val[key])
        } catch (e: any) {}
      })
    }
  }

  const i = obj.$
  if (i && obj === i.proxy) {
    // target is a Vue instance - define on instance.ctx
    defineReactiveSimple(i.ctx, key, val)
    i.accessCache = Object.create(null)
  } else if (isReactive(obj)) {
    obj[key] = val
  } else {
    defineReactiveSimple(obj, key, val)
  }
}
// 定义简单的晌应
function defineReactiveSimple(obj: any, key: string, val: any) {
  val = isObject(val) ? reactive(val) : val
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get() {
      track(obj, TrackOpTypes.GET, key)
      return val
    },
    set(newVal) {
      val = isObject(newVal) ? reactive(newVal) : newVal
      trigger(obj, TriggerOpTypes.SET, key, newVal)
    }
  })
}
