import {
  ConcreteComponent,
  Data,
  validateComponentName,
  Component,
  ComponentInternalInstance,
  getExposeProxy
} from './component'
import {
  ComponentOptions,
  MergedComponentOptions,
  RuntimeCompilerOptions
} from './componentOptions'
import {
  ComponentCustomProperties,
  ComponentPublicInstance
} from './componentPublicInstance'
import { Directive, validateDirectiveName } from './directives'
import { RootRenderFunction } from './renderer'
import { InjectionKey } from './apiInject'
import { warn } from './warning'
import { createVNode, cloneVNode, VNode } from './vnode'
import { RootHydrateFunction } from './hydration'
import { devtoolsInitApp, devtoolsUnmountApp } from './devtools'
import { isFunction, NO, isObject, extend } from '@vue/shared'
import { version } from '.'
import { installAppCompatProperties } from './compat/global'
import { NormalizedPropsOptions } from './componentProps'
import { ObjectEmitsOptions } from './componentEmits'

export interface App<HostElement = any> {
  version: string
  config: AppConfig

  use<Options extends unknown[]>(
    plugin: Plugin<Options>,
    ...options: Options
  ): this
  use<Options>(plugin: Plugin<Options>, options: Options): this

  mixin(mixin: ComponentOptions): this
  component(name: string): Component | undefined
  component(name: string, component: Component): this
  directive(name: string): Directive | undefined
  directive(name: string, directive: Directive): this
  mount(
    rootContainer: HostElement | string,
    isHydrate?: boolean,
    isSVG?: boolean
  ): ComponentPublicInstance
  unmount(): void
  provide<T>(key: InjectionKey<T> | string, value: T): this

  /**
   * Runs a function with the app as active instance. This allows using of `inject()` within the function to get access
   * to variables provided via `app.provide()`.
   *
   * @param fn - function to run with the app as active instance
   */
  runWithContext<T>(fn: () => T): T

  // internal, but we need to expose these for the server-renderer and devtools
  _uid: number
  _component: ConcreteComponent
  _props: Data | null
  _container: HostElement | null
  _context: AppContext
  _instance: ComponentInternalInstance | null

  /**
   * v2 compat only
   */
  filter?(name: string): Function | undefined
  filter?(name: string, filter: Function): this

  /**
   * @internal v3 compat only
   */
  _createRoot?(options: ComponentOptions): ComponentPublicInstance
}

export type OptionMergeFunction = (to: unknown, from: unknown) => any

export interface AppConfig {
  // @private
  readonly isNativeTag?: (tag: string) => boolean

  performance: boolean
  optionMergeStrategies: Record<string, OptionMergeFunction>
  globalProperties: ComponentCustomProperties & Record<string, any>
  errorHandler?: (
    err: unknown,
    instance: ComponentPublicInstance | null,
    info: string
  ) => void
  warnHandler?: (
    msg: string,
    instance: ComponentPublicInstance | null,
    trace: string
  ) => void

  /**
   * Options to pass to `@vue/compiler-dom`.
   * Only supported in runtime compiler build.
   */
  compilerOptions: RuntimeCompilerOptions

  /**
   * @deprecated use config.compilerOptions.isCustomElement
   */
  isCustomElement?: (tag: string) => boolean

  // TODO remove in 3.4
  /**
   * Temporary config for opt-in to unwrap injected refs.
   * @deprecated this no longer has effect. 3.3 always unwraps injected refs.
   */
  unwrapInjectedRef?: boolean
}

export interface AppContext {
  app: App // for devtools
  config: AppConfig
  mixins: ComponentOptions[]
  components: Record<string, Component>
  directives: Record<string, Directive>
  provides: Record<string | symbol, any>

  /**
   * Cache for merged/normalized component options
   * Each app instance has its own cache because app-level global mixins and
   * optionMergeStrategies can affect merge behavior.
   * @internal
   */
  optionsCache: WeakMap<ComponentOptions, MergedComponentOptions>
  /**
   * Cache for normalized props options
   * @internal
   */
  propsCache: WeakMap<ConcreteComponent, NormalizedPropsOptions>
  /**
   * Cache for normalized emits options
   * @internal
   */
  emitsCache: WeakMap<ConcreteComponent, ObjectEmitsOptions | null>
  /**
   * HMR only
   * @internal
   */
  reload?: () => void
  /**
   * v2 compat only
   * @internal
   */
  filters?: Record<string, Function>
}

type PluginInstallFunction<Options> = Options extends unknown[]
  ? (app: App, ...options: Options) => any
  : (app: App, options: Options) => any

export type Plugin<Options = any[]> =
  | (PluginInstallFunction<Options> & {
      install?: PluginInstallFunction<Options>
    })
  | {
      install: PluginInstallFunction<Options>
    }
// 创建APP 的上下文对象
export function createAppContext(): AppContext {
  return {
    app: null as any,
    config: {
      isNativeTag: NO,
      performance: false,
      globalProperties: {},
      optionMergeStrategies: {},
      errorHandler: undefined,
      warnHandler: undefined,
      compilerOptions: {}
    },
    mixins: [],
    components: {},
    directives: {},
    provides: Object.create(null),
    optionsCache: new WeakMap(),
    propsCache: new WeakMap(),
    emitsCache: new WeakMap()
  }
}

export type CreateAppFunction<HostElement> = (
  rootComponent: Component,
  rootProps?: Data | null
) => App<HostElement>

let uid = 0
//创建APP API
export function createAppAPI<HostElement>(
  render: RootRenderFunction<HostElement>,
  hydrate?: RootHydrateFunction
): CreateAppFunction<HostElement> {
  // 返回创建APP方法
  return function createApp(rootComponent, rootProps = null) {
    // 如果根组件是函数
    if (!isFunction(rootComponent)) {
      // 改变指向
      rootComponent = extend({}, rootComponent)
    }
    // 如果根属性不为空，与不是对象抛出错误
    if (rootProps != null && !isObject(rootProps)) {
      __DEV__ && warn(`root props passed to app.mount() must be an object.`)
      rootProps = null
    }
    // 上上下文对象为创建的APP内容
    const context = createAppContext()

    // TODO remove in 3.4
    // 如果是开发环境
    if (__DEV__) {
      // 获取属性时返回真，设置属性时抛出错误
      Object.defineProperty(context.config, 'unwrapInjectedRef', {
        get() {
          return true
        },
        set() {
          warn(
            `app.config.unwrapInjectedRef has been deprecated. ` +
              `3.3 now always unwraps injected refs in Options API.`
          )
        }
      })
    }
    // 初始化插件为桶
    const installedPlugins = new Set()
    // 是挂载设置为false
    let isMounted = false
    // 指向方法并传入参数
    const app: App = (context.app = {
      // uid 每调用一次自增
      _uid: uid++,
      // 组件默认设置为根组件
      _component: rootComponent as ConcreteComponent,
      // 根属性指向
      _props: rootProps,
      _container: null,
      // 上下文对象指向
      _context: context,
      _instance: null,
      // 版本指向
      version,
      // confit指向
      get config() {
        return context.config
      },
      // 设置全局属性
      set config(v) {
        // 如果是开发环境抛出警告
        if (__DEV__) {
          warn(
            `app.config cannot be replaced. Modify individual options instead.`
          )
        }
      },
      // use方法
      use(plugin: Plugin, ...options: any[]) {
        // 如果安装插件有plugin
        if (installedPlugins.has(plugin)) {
          // 如果是开发环境抛出警告
          __DEV__ && warn(`Plugin has already been applied to target app.`)
          // 如果插件为真与是函数
        } else if (plugin && isFunction(plugin.install)) {
          // 安装插件中添加插件
          installedPlugins.add(plugin)
          // 插件安装执行
          plugin.install(app, ...options)
          // 如果是函数
        } else if (isFunction(plugin)) {
          // 添加插件并且运行插件
          installedPlugins.add(plugin)
          plugin(app, ...options)
          // 如果是开发环境 抛出警告
        } else if (__DEV__) {
          warn(
            `A plugin must either be a function or an object with an "install" ` +
              `function.`
          )
        }
        // 返回APP对象
        return app
      },
      // 混合方法
      mixin(mixin: ComponentOptions) {
        // 如果选项API为真
        if (__FEATURE_OPTIONS_API__) {
          // 如果在上下文对象中没有搜索到mixin 在上下文对象中的mixins 压入mixin
          if (!context.mixins.includes(mixin)) {
            context.mixins.push(mixin)
            // 如果是开发环境抛出警告
          } else if (__DEV__) {
            warn(
              'Mixin has already been applied to target app' +
                (mixin.name ? `: ${mixin.name}` : '')
            )
          }
          // 抛出警告
        } else if (__DEV__) {
          warn('Mixins are only available in builds supporting Options API')
        }
        // 返回  app
        return app
      },
      // 组件
      component(name: string, component?: Component): any {
        // 如果是开发环境
        if (__DEV__) {
          // 验证组件
          validateComponentName(name, context.config)
        }
        // 如果组件为假 返回组件
        if (!component) {
          return context.components[name]
        }
        // 如果组件名称存在抛出组件已注册
        if (__DEV__ && context.components[name]) {
          warn(`Component "${name}" has already been registered in target app.`)
        }
        context.components[name] = component
        // 返回app
        return app
      },
      // 指令方法
      directive(name: string, directive?: Directive) {
        // 如果是开发环境验证指向名称
        if (__DEV__) {
          validateDirectiveName(name)
        }
        // 如果指令不存在返回指令名称
        if (!directive) {
          return context.directives[name] as any
        }
        // 如果是开发环境，与指令名称为真抛出警告指令已注册
        if (__DEV__ && context.directives[name]) {
          warn(`Directive "${name}" has already been registered in target app.`)
        }
        // 改变指令指向
        context.directives[name] = directive
        return app
      },
      // 挂载方法
      mount(
        rootContainer: HostElement,
        isHydrate?: boolean,
        isSVG?: boolean
      ): any {
        // 如果挂载为假
        if (!isMounted) {
          // #5571
          // 如果是开发环境与根内容APP为真抛出警告
          if (__DEV__ && (rootContainer as any).__vue_app__) {
            warn(
              `There is already an app instance mounted on the host container.\n` +
                ` If you want to mount another app on the same host container,` +
                ` you need to unmount the previous app by calling \`app.unmount()\` first.`
            )
          }
          // 创建节点
          const vnode = createVNode(rootComponent, rootProps)
          // store app context on the root VNode.
          // this will be set on the root instance on initial mount.
          // 节点APP 内窝指向
          vnode.appContext = context

          // HMR root reload
          // 如果是开发歪境重载
          if (__DEV__) {
            context.reload = () => {
              render(cloneVNode(vnode), rootContainer, isSVG)
            }
          }
          // 如是是SSR的激活 真与激活存在激活HTML
          if (isHydrate && hydrate) {
            hydrate(vnode as VNode<Node, Element>, rootContainer as any)
          } else {
            // 渲染内容
            render(vnode, rootContainer, isSVG)
          }
          // 是挂载设置为真
          isMounted = true
          app._container = rootContainer
          // for devtools and telemetry
          ;(rootContainer as any).__vue_app__ = app
          //如果是开发环境与属笥开发工具为真
          if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
            app._instance = vnode.component
            // 开发工具初始化APP
            devtoolsInitApp(app, version)
          }
          // 获取导出代理
          return getExposeProxy(vnode.component!) || vnode.component!.proxy
        } else if (__DEV__) {
          // 抛出警告内容
          warn(
            `App has already been mounted.\n` +
              `If you want to remount the same app, move your app creation logic ` +
              `into a factory function and create fresh app instances for each ` +
              `mount - e.g. \`const createMyApp = () => createApp(App)\``
          )
        }
      },
      // 解除挂载
      unmount() {
        if (isMounted) {
          render(null, app._container)
          if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
            app._instance = null
            devtoolsUnmountApp(app)
          }
          delete app._container.__vue_app__
        } else if (__DEV__) {
          warn(`Cannot unmount an app that is not mounted.`)
        }
      },
      // 注入内容
      provide(key, value) {
        if (__DEV__ && (key as string | symbol) in context.provides) {
          warn(
            `App already provides property with key "${String(key)}". ` +
              `It will be overwritten with the new value.`
          )
        }

        context.provides[key as string | symbol] = value
        // 返回APP
        return app
      },
      // 在上下文运行
      runWithContext(fn) {
        currentApp = app
        try {
          return fn()
        } finally {
          currentApp = null
        }
      }
    })

    // 如果兼容为真安装 APP兼容属性
    if (__COMPAT__) {
      installAppCompatProperties(app, context, render)
    }
    // 返回APP
    return app
  }
}

/**
 * @internal Used to identify the current app when using `inject()` within
 * `app.runWithContext()`.
 */
export let currentApp: App<unknown> | null = null
