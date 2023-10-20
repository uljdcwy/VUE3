// This entry exports the runtime only, and is built as
// `dist/vue.esm-bundler.js` which is used by default for bundlers.
import { initDev } from './dev'
import {
  compatUtils,
  createApp,
  Transition,
  TransitionGroup,
  KeepAlive,
  DeprecationTypes,
  vShow,
  vModelDynamic
} from '@vue/runtime-dom'
import { extend } from '@vue/shared'

if (__DEV__) {
  initDev()
}

import * as runtimeDom from '@vue/runtime-dom'
// 外层创建APP
function wrappedCreateApp(...args: any[]) {
  // @ts-ignore 创建APP 
  const app = createApp(...args)
  // 如果兼容工具是兼容启用
  if (compatUtils.isCompatEnabled(DeprecationTypes.RENDER_FUNCTION, null)) {
    // register built-in components so that they can be resolved via strings
    // in the legacy h() call. The __compat__ prefix is to ensure that v3 h()
    // doesn't get affected.
    // 添加组件过渡
    app.component('__compat__transition', Transition)
    // 添加组件过渡组
    app.component('__compat__transition-group', TransitionGroup)
    // 添加组件缓存
    app.component('__compat__keep-alive', KeepAlive)
    // built-in directives. No need for prefix since there's no render fn API
    // for resolving directives via string in v3.
    app._context.directives.show = vShow
    app._context.directives.model = vModelDynamic
  }
  return app
}
//创建兼容VUE
export function createCompatVue() {
  const Vue = compatUtils.createCompatVue(createApp, wrappedCreateApp)
  extend(Vue, runtimeDom)
  return Vue
}
