import {
  getCurrentInstance,
  DeprecationTypes,
  LegacyConfig,
  compatUtils,
  ComponentInternalInstance
} from '@vue/runtime-core'
import { hyphenate, isArray } from '@vue/shared'

const systemModifiers = ['ctrl', 'shift', 'alt', 'meta']

type KeyedEvent = KeyboardEvent | MouseEvent | TouchEvent
// 事件后缀
const modifierGuards: Record<
  string,
  (e: Event, modifiers: string[]) => void | boolean
> = {
  stop: e => e.stopPropagation(),
  prevent: e => e.preventDefault(),
  self: e => e.target !== e.currentTarget,
  ctrl: e => !(e as KeyedEvent).ctrlKey,
  shift: e => !(e as KeyedEvent).shiftKey,
  alt: e => !(e as KeyedEvent).altKey,
  meta: e => !(e as KeyedEvent).metaKey,
  left: e => 'button' in e && (e as MouseEvent).button !== 0,
  middle: e => 'button' in e && (e as MouseEvent).button !== 1,
  right: e => 'button' in e && (e as MouseEvent).button !== 2,
  exact: (e, modifiers) =>
    systemModifiers.some(m => (e as any)[`${m}Key`] && !modifiers.includes(m))
}

/**
 * @private
 */
// 在事件中查看后䭴是否存在如果存在返回空否则返回方法
export const withModifiers = (fn: Function, modifiers: string[]) => {
  return (event: Event, ...args: unknown[]) => {
    for (let i = 0; i < modifiers.length; i++) {
      const guard = modifierGuards[modifiers[i]]
      if (guard && guard(event, modifiers)) return
    }
    return fn(event, ...args)
  }
}

// Kept for 2.x compat.
// Note: IE11 compat for `spacebar` and `del` is removed for now.
const keyNames: Record<string, string | string[]> = {
  esc: 'escape',
  space: ' ',
  up: 'arrow-up',
  left: 'arrow-left',
  right: 'arrow-right',
  down: 'arrow-down',
  delete: 'backspace'
}

/**
 * @private
 */
// 查看是否有后缀键
export const withKeys = (fn: Function, modifiers: string[]) => {
  let globalKeyCodes: LegacyConfig['keyCodes']
  let instance: ComponentInternalInstance | null = null
  if (__COMPAT__) {
    // 获取当前上下文对象
    instance = getCurrentInstance()
    // 如果是兼容启用
    if (
      compatUtils.isCompatEnabled(DeprecationTypes.CONFIG_KEY_CODES, instance)
    ) {
      // 如果上下文对象为真
      if (instance) {
        globalKeyCodes = (instance.appContext.config as LegacyConfig).keyCodes
      }
    }
    // 如果是开发环境，在后缀描述中找数字结属
    if (__DEV__ && modifiers.some(m => /^\d+$/.test(m))) {
      compatUtils.warnDeprecation(
        DeprecationTypes.V_ON_KEYCODE_MODIFIER,
        instance
      )
    }
  }
  // 返回方法
  return (event: KeyboardEvent) => {
    // 如果key在event中 往下执行，否则返回空
    if (!('key' in event)) {
      return
    }
    // 获取事件的键
    const eventKey = hyphenate(event.key)
    // 如果后缀中有事件键，返回事件执行
    if (modifiers.some(k => k === eventKey || keyNames[k] === eventKey)) {
      return fn(event)
    }
    // 如果兼容为真
    if (__COMPAT__) {
      // 获取键码
      const keyCode = String(event.keyCode)
      // 如果兼容启用
      if (
        compatUtils.isCompatEnabled(
          DeprecationTypes.V_ON_KEYCODE_MODIFIER,
          instance
        ) &&
        // 如果mod为键码
        modifiers.some(mod => mod == keyCode)
      ) {
        // 返回函数执行
        return fn(event)
      }
      // 如果全局键码为真
      if (globalKeyCodes) {
        // 循环后缀
        for (const mod of modifiers) {
          // 获取全局中的mod 
          const codes = globalKeyCodes[mod]
          // 如果存在
          if (codes) {
            // 如果是数组
            const matches = isArray(codes)
              ? codes.some(code => String(code) === keyCode)
              : String(codes) === keyCode
            if (matches) {
              // 返回函数执行
              return fn(event)
            }
          }
        }
      }
    }
  }
}
