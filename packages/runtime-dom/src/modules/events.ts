import { hyphenate, isArray } from '@vue/shared'
import {
  ErrorCodes,
  ComponentInternalInstance,
  callWithAsyncErrorHandling
} from '@vue/runtime-core'

interface Invoker extends EventListener {
  value: EventValue
  attached: number
}

type EventValue = Function | Function[]
// 元素监听方法对元素的事件进行监听
export function addEventListener(
  el: Element,
  event: string,
  handler: EventListener,
  options?: EventListenerOptions
) {
  el.addEventListener(event, handler, options)
}
// 移除元素的监听
export function removeEventListener(
  el: Element,
  event: string,
  handler: EventListener,
  options?: EventListenerOptions
) {
  el.removeEventListener(event, handler, options)
}
// 更新event
export function patchEvent(
  el: Element & { _vei?: Record<string, Invoker | undefined> },
  rawName: string,
  prevValue: EventValue | null,
  nextValue: EventValue | null,
  instance: ComponentInternalInstance | null = null
) {
  // vei = vue event invokers
  const invokers = el._vei || (el._vei = {})
  const existingInvoker = invokers[rawName]
  if (nextValue && existingInvoker) {
    // patch 退出调用指向
    existingInvoker.value = nextValue
  } else {
    // 解构编译的名称
    const [name, options] = parseName(rawName)
    if (nextValue) {
      // add 创建调用
      const invoker = (invokers[rawName] = createInvoker(nextValue, instance))
      // 监听元素
      addEventListener(el, name, invoker, options)
    } else if (existingInvoker) {
      // remove 移除监听
      removeEventListener(el, name, existingInvoker, options)
      // 调用指向undefined
      invokers[rawName] = undefined
    }
  }
}
// 
const optionsModifierRE = /(?:Once|Passive|Capture)$/
// 编译名称
function parseName(name: string): [string, EventListenerOptions | undefined] {
  let options: EventListenerOptions | undefined
  if (optionsModifierRE.test(name)) {
    options = {}
    let m
    while ((m = name.match(optionsModifierRE))) {
      name = name.slice(0, name.length - m[0].length)
      ;(options as any)[m[0].toLowerCase()] = true
    }
  }
  const event = name[2] === ':' ? name.slice(3) : hyphenate(name.slice(2))
  // 返回事件与选项
  return [event, options]
}

// To avoid the overhead of repeatedly calling Date.now(), we cache
// and use the same timestamp for all event listeners attached in the same tick.
let cachedNow: number = 0
const p = /*#__PURE__*/ Promise.resolve()
// 获取现在的时间
const getNow = () =>
  cachedNow || (p.then(() => (cachedNow = 0)), (cachedNow = Date.now()))
// 创建调用
function createInvoker(
  initialValue: EventValue,
  instance: ComponentInternalInstance | null
) {
  // 调用指向
  const invoker: Invoker = (e: Event & { _vts?: number }) => {
    // async edge case vuejs/vue#6566
    // inner click event triggers patch, event handler
    // attached to outer element during patch, and triggered again. This
    // happens because browsers fire microtask ticks between event propagation.
    // this no longer happens for templates in Vue 3, but could still be
    // theoretically possible for hand-written render functions.
    // the solution: we save the timestamp when a handler is attached,
    // and also attach the timestamp to any event that was handled by vue
    // for the first time (to avoid inconsistent event timestamp implementations
    // or events fired from iframes, e.g. #2513)
    // The handler would only fire if the event passed to it was fired
    // AFTER it was attached.
    // 如果时间为假时更新时间
    if (!e._vts) {
      e._vts = Date.now()
      // 如果时间小于调用的时间返回
    } else if (e._vts <= invoker.attached) {
      return
    }
    // 执行异步错误勾子
    callWithAsyncErrorHandling(
      patchStopImmediatePropagation(e, invoker.value),
      instance,
      ErrorCodes.NATIVE_EVENT_HANDLER,
      [e]
    )
  }
  // 调用指向
  invoker.value = initialValue
  // 更新时间
  invoker.attached = getNow()
  // 返回调用
  return invoker
}
// 判断stop 修饰符
function patchStopImmediatePropagation(
  e: Event,
  value: EventValue
): EventValue {
  // 如果是数组
  if (isArray(value)) {
    const originalStop = e.stopImmediatePropagation
    e.stopImmediatePropagation = () => {
      originalStop.call(e)
      ;(e as any)._stopped = true
    }
    // 返回函数执行如果stop为真不执行
    return value.map(fn => (e: Event) => !(e as any)._stopped && fn && fn(e))
  } else {
    // 返回值
    return value
  }
}
