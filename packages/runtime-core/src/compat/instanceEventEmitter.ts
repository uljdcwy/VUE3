import { isArray } from '@vue/shared'
import { ComponentInternalInstance } from '../component'
import { callWithAsyncErrorHandling, ErrorCodes } from '../errorHandling'
import { assertCompatEnabled, DeprecationTypes } from './compatConfig'

interface EventRegistry {
  [event: string]: Function[] | undefined
}

const eventRegistryMap = /*#__PURE__*/ new WeakMap<
  ComponentInternalInstance,
  EventRegistry
>()
// 获取注册方法
export function getRegistry(
  instance: ComponentInternalInstance
): EventRegistry {
  let events = eventRegistryMap.get(instance)
  if (!events) {
    eventRegistryMap.set(instance, (events = Object.create(null)))
  }
  return events!
}
// on方法
export function on(
  instance: ComponentInternalInstance,
  event: string | string[],
  fn: Function
) {
  // 如果方法是数组
  if (isArray(event)) {
    // 循环注册
    event.forEach(e => on(instance, e, fn))
  } else {
    // 如果event有hook: 启用断言兼容
    if (event.startsWith('hook:')) {
      assertCompatEnabled(
        DeprecationTypes.INSTANCE_EVENT_HOOKS,
        instance,
        event
      )
    } else {
      // 启用断言兼容
      assertCompatEnabled(DeprecationTypes.INSTANCE_EVENT_EMITTER, instance)
    }
    // 获取注册方法
    const events = getRegistry(instance)
    ;(events[event] || (events[event] = [])).push(fn)
  }
  // 返回上下文代理对象
  return instance.proxy
}
// once方法
export function once(
  instance: ComponentInternalInstance,
  event: string,
  fn: Function
) {
  const wrapped = (...args: any[]) => {
    off(instance, event, wrapped)
    fn.call(instance.proxy, ...args)
  }
  wrapped.fn = fn
  on(instance, event, wrapped)
  return instance.proxy
}
// off方法
export function off(
  instance: ComponentInternalInstance,
  event?: string | string[],
  fn?: Function
) {
  // 启用断言兼容
  assertCompatEnabled(DeprecationTypes.INSTANCE_EVENT_EMITTER, instance)
  // 指向上下文代理方法
  const vm = instance.proxy
  // all
  // 如果event为假
  if (!event) {
    // 注册event
    eventRegistryMap.set(instance, Object.create(null))
    return vm
  }
  // array of events
  // 如果event为数组注册多个方汉
  if (isArray(event)) {
    event.forEach(e => off(instance, e, fn))
    return vm
  }
  // specific event
  // 获取event
  const events = getRegistry(instance)
  const cbs = events[event!]
  if (!cbs) {
    return vm
  }
  if (!fn) {
    events[event!] = undefined
    return vm
  }
  events[event!] = cbs.filter(cb => !(cb === fn || (cb as any).fn === fn))
  // 返回vm
  return vm
}
// emit方法
export function emit(
  instance: ComponentInternalInstance,
  event: string,
  args: any[]
) {
  const cbs = getRegistry(instance)[event]
  if (cbs) {
    // 
    callWithAsyncErrorHandling(
      cbs.map(cb => cb.bind(instance.proxy)),
      instance,
      ErrorCodes.COMPONENT_EVENT_HANDLER,
      args
    )
  }
  // 返回上下文对象的代理对象
  return instance.proxy
}
