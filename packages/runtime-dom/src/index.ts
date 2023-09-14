import {
  createRenderer,
  createHydrationRenderer,
  warn,
  RootRenderFunction,
  CreateAppFunction,
  Renderer,
  HydrationRenderer,
  App,
  RootHydrateFunction,
  isRuntimeOnly,
  DeprecationTypes,
  compatUtils
} from '@vue/runtime-core'
import { nodeOps } from './nodeOps'
import { patchProp } from './patchProp'
// Importing from the compiler, will be tree-shaken in prod
import {
  isFunction,
  isString,
  isHTMLTag,
  isSVGTag,
  extend,
  NOOP
} from '@vue/shared'

declare module '@vue/reactivity' {
  export interface RefUnwrapBailTypes {
    runtimeDOMBailTypes: Node | Window
  }
}
// 合并更新属性
const rendererOptions = /*#__PURE__*/ extend({ patchProp }, nodeOps)

// lazy create the renderer - this makes core renderer logic tree-shakable
// in case the user only imports reactivity utilities from Vue.
let renderer: Renderer<Element | ShadowRoot> | HydrationRenderer

let enabledHydration = false
// 确保渲染器
function ensureRenderer() {
  // 返回渲染器
  return (
    renderer ||
    (renderer = createRenderer<Node, Element | ShadowRoot>(rendererOptions))
  )
}
// 确保激活渲染器
function ensureHydrationRenderer() {
  renderer = enabledHydration
    ? renderer
    : createHydrationRenderer(rendererOptions)
  enabledHydration = true
  // 返回渲染器
  return renderer as HydrationRenderer
}

// use explicit type casts here to avoid import() calls in rolled-up d.ts 渲染
export const render = ((...args) => {
  // 确保渲染的返回值渲染
  ensureRenderer().render(...args)
}) as RootRenderFunction<Element | ShadowRoot>
// 激活
export const hydrate = ((...args) => {
  // 确认激活渲染，激活
  ensureHydrationRenderer().hydrate(...args)
}) as RootHydrateFunction
// 创建APP
export const createApp = ((...args) => {
  // 创建APP
  const app = ensureRenderer().createApp(...args)
  // 如果是开发环境
  if (__DEV__) {
    // 激活NATIVE标签检查
    injectNativeTagCheck(app)
    // 注秒勾子选项检查
    injectCompilerOptionsCheck(app)
  }
  // 解构出挂载
  const { mount } = app
  // 更新APP挂载指向
  app.mount = (containerOrSelector: Element | ShadowRoot | string): any => {
    // 格式化容器
    const container = normalizeContainer(containerOrSelector)
    // 如果容器为假
    if (!container) return
    // 获取APP组件
    const component = app._component
    // 如果组件不是函数
    if (!isFunction(component) && !component.render && !component.template) {
      // __UNSAFE__
      // Reason: potential execution of JS expressions in in-DOM template.
      // The user must make sure the in-DOM template is trusted. If it's
      // rendered by the server, the template should not contain any user data.
      // 组件模版指向容器内容
      component.template = container.innerHTML
      // 2.x compat check
      if (__COMPAT__ && __DEV__) {
        for (let i = 0; i < container.attributes.length; i++) {
          const attr = container.attributes[i]
          if (attr.name !== 'v-cloak' && /^(v-|:|@)/.test(attr.name)) {
            compatUtils.warnDeprecation(
              DeprecationTypes.GLOBAL_MOUNT_CONTAINER,
              null
            )
            break
          }
        }
      }
    }

    // clear content before mounting 清除内容
    container.innerHTML = ''
    // 代理指向挂载
    const proxy = mount(container, false, container instanceof SVGElement)
    // 如果内容在元素中
    if (container instanceof Element) {
      // 内容中移除属性v-cloak
      container.removeAttribute('v-cloak')
      // 内容设置属性data-v-app为空
      container.setAttribute('data-v-app', '')
    }
    // 返回代理对象
    return proxy
  }
  // 返回app
  return app
}) as CreateAppFunction<Element>
// 创建SSRApp
export const createSSRApp = ((...args) => {
  // 确保激活渲染创建APP
  const app = ensureHydrationRenderer().createApp(...args)
  // 如果是开发环境
  if (__DEV__) {
    injectNativeTagCheck(app)
    injectCompilerOptionsCheck(app)
  }
  // 解构挂载
  const { mount } = app
  // APP挂载指向
  app.mount = (containerOrSelector: Element | ShadowRoot | string): any => {
    // 内容指向格式化内容
    const container = normalizeContainer(containerOrSelector)
    // 如果内容为真
    if (container) {
      // 挂载内容
      return mount(container, true, container instanceof SVGElement)
    }
  }
  // 返回APP
  return app
}) as CreateAppFunction<Element>

function injectNativeTagCheck(app: App) {
  // Inject `isNativeTag`
  // this is used for component name validation (dev only)
  Object.defineProperty(app.config, 'isNativeTag', {
    value: (tag: string) => isHTMLTag(tag) || isSVGTag(tag),
    writable: false
  })
}

// dev only 注入勾子选项检查
function injectCompilerOptionsCheck(app: App) {
  // 如果只在运行时
  if (isRuntimeOnly()) {
    // 如果是自定义元素
    const isCustomElement = app.config.isCustomElement
    // 定义APP全局代理
    Object.defineProperty(app.config, 'isCustomElement', {
      get() {
        return isCustomElement
      },
      set() {
        warn(
          `The \`isCustomElement\` config option is deprecated. Use ` +
            `\`compilerOptions.isCustomElement\` instead.`
        )
      }
    })
    // 勾子选项指向
    const compilerOptions = app.config.compilerOptions
    // 消息指向
    const msg =
      `The \`compilerOptions\` config option is only respected when using ` +
      `a build of Vue.js that includes the runtime compiler (aka "full build"). ` +
      `Since you are using the runtime-only build, \`compilerOptions\` ` +
      `must be passed to \`@vue/compiler-dom\` in the build setup instead.\n` +
      `- For vue-loader: pass it via vue-loader's \`compilerOptions\` loader option.\n` +
      `- For vue-cli: see https://cli.vuejs.org/guide/webpack.html#modifying-options-of-a-loader\n` +
      `- For vite: pass it via @vitejs/plugin-vue options. See https://github.com/vitejs/vite-plugin-vue/tree/main/packages/plugin-vue#example-for-passing-options-to-vuecompiler-sfc`
    // 代理全局配置
    Object.defineProperty(app.config, 'compilerOptions', {
      get() {
        warn(msg)
        return compilerOptions
      },
      set() {
        warn(msg)
      }
    })
  }
}
// 格式化内容
function normalizeContainer(
  container: Element | ShadowRoot | string
): Element | null {
  // 如果是字符串
  if (isString(container)) {
    // 查找DOM
    const res = document.querySelector(container)
    if (__DEV__ && !res) {
      warn(
        `Failed to mount app: mount target selector "${container}" returned null.`
      )
    }
    // 返回DOM
    return res
  }
  if (
    __DEV__ &&
    window.ShadowRoot &&
    container instanceof window.ShadowRoot &&
    container.mode === 'closed'
  ) {
    warn(
      `mounting on a ShadowRoot with \`{mode: "closed"}\` may lead to unpredictable bugs`
    )
  }
  // 返回内容
  return container as any
}

// Custom element support
export {
  defineCustomElement,
  defineSSRCustomElement,
  VueElement,
  type VueElementConstructor
} from './apiCustomElement'

// SFC CSS utilities
export { useCssModule } from './helpers/useCssModule'
export { useCssVars } from './helpers/useCssVars'

// DOM-only components
export { Transition, type TransitionProps } from './components/Transition'
export {
  TransitionGroup,
  type TransitionGroupProps
} from './components/TransitionGroup'

// **Internal** DOM-only runtime directive helpers
export {
  vModelText,
  vModelCheckbox,
  vModelRadio,
  vModelSelect,
  vModelDynamic
} from './directives/vModel'
export { withModifiers, withKeys } from './directives/vOn'
export { vShow } from './directives/vShow'

import { initVModelForSSR } from './directives/vModel'
import { initVShowForSSR } from './directives/vShow'

let ssrDirectiveInitialized = false

/**
 * @internal
 */
export const initDirectivesForSSR = __SSR__
  ? () => {
      if (!ssrDirectiveInitialized) {
        ssrDirectiveInitialized = true
        initVModelForSSR()
        initVShowForSSR()
      }
    }
  : NOOP

// re-export everything from core
// h, Component, reactivity API, nextTick, flags & types
export * from '@vue/runtime-core'

export * from './jsx'
