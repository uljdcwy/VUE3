import {
  camelize,
  extend,
  hyphenate,
  isArray,
  isObject,
  isReservedProp,
  normalizeClass
} from '@vue/shared'
import { ComponentInternalInstance } from '../component'
import { Slot } from '../componentSlots'
import { createSlots } from '../helpers/createSlots'
import { renderSlot } from '../helpers/renderSlot'
import { toHandlers } from '../helpers/toHandlers'
import { mergeProps, VNode } from '../vnode'
// 数组转对象
function toObject(arr: Array<any>): Object {
  const res = {}
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]) {
      extend(res, arr[i])
    }
  }
  return res
}
// 旧版绑定对角属笥
export function legacyBindObjectProps(
  data: any,
  _tag: string,
  value: any,
  _asProp: boolean,
  isSync?: boolean
) {
  if (value && isObject(value)) {
    if (isArray(value)) {
      value = toObject(value)
    }
    for (const key in value) {
      if (isReservedProp(key)) {
        data[key] = value[key]
      } else if (key === 'class') {
        data.class = normalizeClass([data.class, value.class])
      } else if (key === 'style') {
        data.style = normalizeClass([data.style, value.style])
      } else {
        const attrs = data.attrs || (data.attrs = {})
        const camelizedKey = camelize(key)
        const hyphenatedKey = hyphenate(key)
        if (!(camelizedKey in attrs) && !(hyphenatedKey in attrs)) {
          attrs[key] = value[key]

          if (isSync) {
            const on = data.on || (data.on = {})
            on[`update:${key}`] = function ($event: any) {
              value[key] = $event
            }
          }
        }
      }
    }
  }
  // 返回data
  return data
}
// 旧版绑定对象监听
export function legacyBindObjectListeners(props: any, listeners: any) {
  return mergeProps(props, toHandlers(listeners))
}
  // 旧版渲染Slot
export function legacyRenderSlot(
  instance: ComponentInternalInstance,
  name: string,
  fallback?: VNode[],
  props?: any,
  bindObject?: any
) {
  // 如果绑定对象为真
  if (bindObject) {
    // 属性指向合并属隆
    props = mergeProps(props, bindObject)
  }
  // 返回渲染的slot
  return renderSlot(instance.slots, name, props, fallback && (() => fallback))
}

type LegacyScopedSlotsData = Array<
  | {
      key: string
      fn: Function
    }
  | LegacyScopedSlotsData
>
// 转换作用域slots
export function legacyresolveScopedSlots(
  fns: LegacyScopedSlotsData,
  raw?: Record<string, Slot>,
  // the following are added in 2.6
  hasDynamicKeys?: boolean
) {
  // v2 default slot doesn't have name
  // 返回创建的slots
  return createSlots(
    raw || ({ $stable: !hasDynamicKeys } as any),
    mapKeyToName(fns)
  )
}
// 对slot名称转换
function mapKeyToName(slots: LegacyScopedSlotsData) {
  for (let i = 0; i < slots.length; i++) {
    const fn = slots[i]
    if (fn) {
      if (isArray(fn)) {
        mapKeyToName(fn)
      } else {
        ;(fn as any).name = fn.key || 'default'
      }
    }
  }
  return slots as any
}

const staticCacheMap = /*#__PURE__*/ new WeakMap<
  ComponentInternalInstance,
  any[]
>()
// 旧版渲染静态
export function legacyRenderStatic(
  instance: ComponentInternalInstance,
  index: number
) {
  let cache = staticCacheMap.get(instance)
  if (!cache) {
    staticCacheMap.set(instance, (cache = []))
  }
  if (cache[index]) {
    return cache[index]
  }
  const fn = (instance.type as any).staticRenderFns[index]
  const ctx = instance.proxy
  // 返回缓存中的方法并记录缓存
  return (cache[index] = fn.call(ctx, null, ctx))
}
// 旧版检查键码
export function legacyCheckKeyCodes(
  instance: ComponentInternalInstance,
  eventKeyCode: number,
  key: string,
  builtInKeyCode?: number | number[],
  eventKeyName?: string,
  builtInKeyName?: string | string[]
) {
  const config = instance.appContext.config as any
  const configKeyCodes = config.keyCodes || {}
  const mappedKeyCode = configKeyCodes[key] || builtInKeyCode
  if (builtInKeyName && eventKeyName && !configKeyCodes[key]) {
    // 返回KEY不配置返回值
    return isKeyNotMatch(builtInKeyName, eventKeyName)
  } else if (mappedKeyCode) {
    // 返
    return isKeyNotMatch(mappedKeyCode, eventKeyCode)
  } else if (eventKeyName) {
    // 返回连字符
    return hyphenate(eventKeyName) !== key
  }
}
// 是键不匹配方法
function isKeyNotMatch<T>(expect: T | T[], actual: T): boolean {
  if (isArray(expect)) {
    return !expect.includes(actual)
  } else {
    return expect !== actual
  }
}
// 兼容标记once
export function legacyMarkOnce(tree: VNode) {
  return tree
}
// 旧版绑定活动的键
export function legacyBindDynamicKeys(props: any, values: any[]) {
  for (let i = 0; i < values.length; i += 2) {
    const key = values[i]
    if (typeof key === 'string' && key) {
      props[values[i]] = values[i + 1]
    }
  }
  // 返回属性
  return props
}

// 旧版前缀
export function legacyPrependModifier(value: any, symbol: string) {
  return typeof value === 'string' ? symbol + value : value
}
