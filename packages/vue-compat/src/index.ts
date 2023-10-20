// This entry is the "full-build" that includes both the runtime
// and the compiler, and supports on-the-fly compilation of the template option.
import { createCompatVue } from './createCompatVue'
import { compile, CompilerError, CompilerOptions } from '@vue/compiler-dom'
import { registerRuntimeCompiler, RenderFunction, warn } from '@vue/runtime-dom'
import { isString, NOOP, generateCodeFrame, extend } from '@vue/shared'
import { InternalRenderFunction } from 'packages/runtime-core/src/component'
import * as runtimeDom from '@vue/runtime-dom'
import {
  DeprecationTypes,
  warnDeprecation
} from '../../runtime-core/src/compat/compatConfig'

const compileCache: Record<string, RenderFunction> = Object.create(null)
// 勾子到函数
function compileToFunction(
  template: string | HTMLElement,
  options?: CompilerOptions
): RenderFunction {
  // 如果模版不是字符串
  if (!isString(template)) {
    // 如果模版节点类型为真时
    if (template.nodeType) {
      // 模版指向模版内容HTML
      template = template.innerHTML
    } else {
      __DEV__ && warn(`invalid template option: `, template)
      return NOOP
    }
  }
  // key指向模版
  const key = template
  // 缓存指向勾子缓存
  const cached = compileCache[key]
  // 如果缓存为真返回缓存
  if (cached) {
    return cached
  }
  // 模版指零个是#号时
  if (template[0] === '#') {
    // el指向查找到的模版
    const el = document.querySelector(template)
    if (__DEV__ && !el) {
      warn(`Template element not found or is empty: ${template}`)
    }
    // __UNSAFE__
    // Reason: potential execution of JS expressions in in-DOM template.
    // The user must make sure the in-DOM template is trusted. If it's rendered
    // by the server, the template should not contain any user data.
    /**@type {HTMLElement|string} 模版指向元素字符 */
    template = el ? el.innerHTML : ``
  }

  if (__DEV__ && !__TEST__ && (!options || !options.whitespace)) {
    warnDeprecation(DeprecationTypes.CONFIG_WHITESPACE, null)
  }
  // 勾子方法获取code
  const { code } = compile(
    template,
    extend(
      {
        hoistStatic: true,
        whitespace: 'preserve',
        onError: __DEV__ ? onError : undefined,
        onWarn: __DEV__ ? e => onError(e, true) : NOOP
      } as CompilerOptions,
      options
    )
  )
      // 错误方法
  function onError(err: CompilerError, asWarning = false) {
    const message = asWarning
      ? err.message
      : `Template compilation error: ${err.message}`
    const codeFrame =
      err.loc &&
      generateCodeFrame(
        template as string,
        err.loc.start.offset,
        err.loc.end.offset
      )
    warn(codeFrame ? `${message}\n${codeFrame}` : message)
  }

  // The wildcard import results in a huge object with every export
  // with keys that cannot be mangled, and can be quite heavy size-wise.
  // In the global build we know `Vue` is available globally so we can avoid
  // the wildcard object.
  const render = (
    __GLOBAL__ ? new Function(code)() : new Function('Vue', code)(runtimeDom)
  ) as RenderFunction

  // mark the function as runtime compiled
  ;(render as InternalRenderFunction)._rc = true
  // 返回缓存的勾子
  return (compileCache[key] = render)
}
// 注册运行时的勾子
registerRuntimeCompiler(compileToFunction)

const Vue = createCompatVue()
Vue.compile = compileToFunction

export default Vue
