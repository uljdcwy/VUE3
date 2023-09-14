import {
  BaseTransition,
  BaseTransitionProps,
  BaseTransitionPropsValidators,
  h,
  assertNumber,
  FunctionalComponent,
  compatUtils,
  DeprecationTypes
} from '@vue/runtime-core'
import { isObject, toNumber, extend, isArray } from '@vue/shared'

const TRANSITION = 'transition'
const ANIMATION = 'animation'

type AnimationTypes = typeof TRANSITION | typeof ANIMATION

export interface TransitionProps extends BaseTransitionProps<Element> {
  name?: string
  type?: AnimationTypes
  css?: boolean
  duration?: number | { enter: number; leave: number }
  // custom transition classes
  enterFromClass?: string
  enterActiveClass?: string
  enterToClass?: string
  appearFromClass?: string
  appearActiveClass?: string
  appearToClass?: string
  leaveFromClass?: string
  leaveActiveClass?: string
  leaveToClass?: string
}

export interface ElementWithTransition extends HTMLElement {
  // _vtc = Vue Transition Classes.
  // Store the temporarily-added transition classes on the element
  // so that we can avoid overwriting them if the element's class is patched
  // during the transition.
  _vtc?: Set<string>
}

// DOM Transition is a higher-order-component based on the platform-agnostic
// base Transition component, with DOM-specific logic. 过渡方法
export const Transition: FunctionalComponent<TransitionProps> = (
  props,
  { slots }
) => h(BaseTransition, resolveTransitionProps(props), slots)

Transition.displayName = 'Transition'

if (__COMPAT__) {
  Transition.__isBuiltIn = true
}

const DOMTransitionPropsValidators = {
  name: String,
  type: String,
  css: {
    type: Boolean,
    default: true
  },
  duration: [String, Number, Object],
  enterFromClass: String,
  enterActiveClass: String,
  enterToClass: String,
  appearFromClass: String,
  appearActiveClass: String,
  appearToClass: String,
  leaveFromClass: String,
  leaveActiveClass: String,
  leaveToClass: String
}

export const TransitionPropsValidators = (Transition.props =
  /*#__PURE__*/ extend(
    {},
    BaseTransitionPropsValidators as any,
    DOMTransitionPropsValidators
  ))

/**
 * #3227 Incoming hooks may be merged into arrays when wrapping Transition
 * with custom HOCs.
 */
// 执行勾子
const callHook = (
  hook: Function | Function[] | undefined,
  args: any[] = []
) => {
  if (isArray(hook)) {
    hook.forEach(h => h(...args))
  } else if (hook) {
    hook(...args)
  }
}

/**
 * Check if a hook expects a callback (2nd arg), which means the user
 * intends to explicitly control the end of the transition.
 */
// 有显示回调
const hasExplicitCallback = (
  hook: Function | Function[] | undefined
): boolean => {
  return hook
    ? isArray(hook)
      ? hook.some(h => h.length > 1)
      : hook.length > 1
    : false
}
// 分析动画属性
export function resolveTransitionProps(
  rawProps: TransitionProps
): BaseTransitionProps<Element> {
  const baseProps: BaseTransitionProps<Element> = {}
  for (const key in rawProps) {
    if (!(key in DOMTransitionPropsValidators)) {
      ;(baseProps as any)[key] = (rawProps as any)[key]
    }
  }

  if (rawProps.css === false) {
    return baseProps
  }

  const {
    name = 'v',
    type,
    duration,
    enterFromClass = `${name}-enter-from`,
    enterActiveClass = `${name}-enter-active`,
    enterToClass = `${name}-enter-to`,
    appearFromClass = enterFromClass,
    appearActiveClass = enterActiveClass,
    appearToClass = enterToClass,
    leaveFromClass = `${name}-leave-from`,
    leaveActiveClass = `${name}-leave-active`,
    leaveToClass = `${name}-leave-to`
  } = rawProps

  // legacy transition class compat 
  const legacyClassEnabled =
    __COMPAT__ &&
    compatUtils.isCompatEnabled(DeprecationTypes.TRANSITION_CLASSES, null)
  let legacyEnterFromClass: string
  let legacyAppearFromClass: string
  let legacyLeaveFromClass: string
  if (__COMPAT__ && legacyClassEnabled) {
    const toLegacyClass = (cls: string) => cls.replace(/-from$/, '')
    if (!rawProps.enterFromClass) {
      // 到早版本
      legacyEnterFromClass = toLegacyClass(enterFromClass)
    }
    if (!rawProps.appearFromClass) {
      // 到早版本
      legacyAppearFromClass = toLegacyClass(appearFromClass)
    }
    if (!rawProps.leaveFromClass) {
      // 到早版本
      legacyLeaveFromClass = toLegacyClass(leaveFromClass)
    }
  }
  // 格式化持续时间
  const durations = normalizeDuration(duration)
  const enterDuration = durations && durations[0]
  const leaveDuration = durations && durations[1]
  const {
    onBeforeEnter,
    onEnter,
    onEnterCancelled,
    onLeave,
    onLeaveCancelled,
    onBeforeAppear = onBeforeEnter,
    onAppear = onEnter,https://www.jslint.com/
    onAppearCancelled = onEnterCancelled
  } = baseProps
  // 完成入口
  const finishEnter = (el: Element, isAppear: boolean, done?: () => void) => {
    // 移除过渡类
    removeTransitionClass(el, isAppear ? appearToClass : enterToClass)
    removeTransitionClass(el, isAppear ? appearActiveClass : enterActiveClass)
    // 完成方法
    done && done()
  }
  // 完成离开
  const finishLeave = (
    el: Element & { _isLeaving?: boolean },
    done?: () => void
  ) => {
    el._isLeaving = false
    // 移除过度类
    removeTransitionClass(el, leaveFromClass)
    removeTransitionClass(el, leaveToClass)
    removeTransitionClass(el, leaveActiveClass)
    // 完成
    done && done()
  }
  // 制作回车勾子
  const makeEnterHook = (isAppear: boolean) => {
    return (el: Element, done: () => void) => {
      const hook = isAppear ? onAppear : onEnter
      // 分析方法指向
      const resolve = () => finishEnter(el, isAppear, done)
      // 回调勾子
      callHook(hook, [el, resolve])
      // 下一帧
      nextFrame(() => {
        // 移除过渡类
        removeTransitionClass(el, isAppear ? appearFromClass : enterFromClass)
        if (__COMPAT__ && legacyClassEnabled) {
          const legacyClass = isAppear
            ? legacyAppearFromClass
            : legacyEnterFromClass
          if (legacyClass) {
            removeTransitionClass(el, legacyClass)
          }
        }
        // 添加过渡类
        addTransitionClass(el, isAppear ? appearToClass : enterToClass)
        if (!hasExplicitCallback(hook)) {
          // 过渡结束时
          whenTransitionEnds(el, type, enterDuration, resolve)
        }
      })
    }
  }
  // 返回扩展对象
  return extend(baseProps, {
    // 过度进入的勾子
    onBeforeEnter(el) {
      // 回调勾子
      callHook(onBeforeEnter, [el])
      // 添加动画类
      addTransitionClass(el, enterFromClass)
      if (__COMPAT__ && legacyClassEnabled && legacyEnterFromClass) {
        // 添加动画类
        addTransitionClass(el, legacyEnterFromClass)
      }
      addTransitionClass(el, enterActiveClass)
    },
    // 过度出现前
    onBeforeAppear(el) {
      // 执行回调勾子
      callHook(onBeforeAppear, [el])
      // 添加动画类
      addTransitionClass(el, appearFromClass)
      if (__COMPAT__ && legacyClassEnabled && legacyAppearFromClass) {
        addTransitionClass(el, legacyAppearFromClass)
      }
      addTransitionClass(el, appearActiveClass)
    },
    // 进入时勾子
    onEnter: makeEnterHook(false),
    // 进入前勾子
    onAppear: makeEnterHook(true),
    // 离开时勾子
    onLeave(el: Element & { _isLeaving?: boolean }, done) {
      el._isLeaving = true
      const resolve = () => finishLeave(el, done)
      addTransitionClass(el, leaveFromClass)
      if (__COMPAT__ && legacyClassEnabled && legacyLeaveFromClass) {
        addTransitionClass(el, legacyLeaveFromClass)
      }
      // force reflow so *-leave-from classes immediately take effect (#2593) 强制回流
      forceReflow()
      // 添加过渡类
      addTransitionClass(el, leaveActiveClass)
      // 下一帧
      nextFrame(() => {
        if (!el._isLeaving) {
          // cancelled
          return
        }
        // 移除过渡类
        removeTransitionClass(el, leaveFromClass)
        if (__COMPAT__ && legacyClassEnabled && legacyLeaveFromClass) {
          removeTransitionClass(el, legacyLeaveFromClass)
        }
        addTransitionClass(el, leaveToClass)
        if (!hasExplicitCallback(onLeave)) {
          // 过渡结束时
          whenTransitionEnds(el, type, leaveDuration, resolve)
        }
      })
      // 执行回调勾子
      callHook(onLeave, [el, resolve])
    },
    // 进入取消勾子
    onEnterCancelled(el) {
      // 完成进入
      finishEnter(el, false)
      // 回调勾子
      callHook(onEnterCancelled, [el])
    },
    // 取消前勾子
    onAppearCancelled(el) {
      // 完成进入
      finishEnter(el, true)
      // 回调勾子
      callHook(onAppearCancelled, [el])
    },
    // 离开取消
    onLeaveCancelled(el) {
      // 完成离开
      finishLeave(el)
      // 回调勾子
      callHook(onLeaveCancelled, [el])
    }
  } as BaseTransitionProps<Element>)
}
// 格式化持续时间
function normalizeDuration(
  duration: TransitionProps['duration']
): [number, number] | null {
  if (duration == null) {
    return null
  } else if (isObject(duration)) {
    return [NumberOf(duration.enter), NumberOf(duration.leave)]
  } else {
    const n = NumberOf(duration)
    return [n, n]
  }
}
// 数字化值
function NumberOf(val: unknown): number {
  const res = toNumber(val)
  if (__DEV__) {
    assertNumber(res, '<transition> explicit duration')
  }
  return res
}
// 添加动画类
export function addTransitionClass(el: Element, cls: string) {
  cls.split(/\s+/).forEach(c => c && el.classList.add(c))
  ;(
    (el as ElementWithTransition)._vtc ||
    ((el as ElementWithTransition)._vtc = new Set())
  ).add(cls)
}
// 移除动画类
export function removeTransitionClass(el: Element, cls: string) {
  cls.split(/\s+/).forEach(c => c && el.classList.remove(c))
  const { _vtc } = el as ElementWithTransition
  if (_vtc) {
    _vtc.delete(cls)
    if (!_vtc!.size) {
      ;(el as ElementWithTransition)._vtc = undefined
    }
  }
}
// 下一帧
function nextFrame(cb: () => void) {
  requestAnimationFrame(() => {
    requestAnimationFrame(cb)
  })
}

let endId = 0
// 过度结束
function whenTransitionEnds(
  el: Element & { _endId?: number },
  expectedType: TransitionProps['type'] | undefined,
  explicitTimeout: number | null,
  resolve: () => void
) {
  const id = (el._endId = ++endId)
  const resolveIfNotStale = () => {
    if (id === el._endId) {
      resolve()
    }
  }

  if (explicitTimeout) {
    return setTimeout(resolveIfNotStale, explicitTimeout)
  }
  // 获取过渡信息
  const { type, timeout, propCount } = getTransitionInfo(el, expectedType)
  if (!type) {
    return resolve()
  }

  const endEvent = type + 'end'
  let ended = 0
  // 结束
  const end = () => {
    // 移除离开监听
    el.removeEventListener(endEvent, onEnd)
    resolveIfNotStale()
  }
  // 结束事件
  const onEnd = (e: Event) => {
    if (e.target === el && ++ended >= propCount) {
      end()
    }
  }
  setTimeout(() => {
    if (ended < propCount) {
      end()
    }
  }, timeout + 1)
  el.addEventListener(endEvent, onEnd)
}

interface CSSTransitionInfo {
  type: AnimationTypes | null
  propCount: number
  timeout: number
  hasTransform: boolean
}

type AnimationProperties = 'Delay' | 'Duration'
type StylePropertiesKey =
  | `${AnimationTypes}${AnimationProperties}`
  | `${typeof TRANSITION}Property`
// 获取过渡信息
export function getTransitionInfo(
  el: Element,
  expectedType?: TransitionProps['type']
): CSSTransitionInfo {
  // 获取计算样式
  const styles = window.getComputedStyle(el) as Pick<
    CSSStyleDeclaration,
    StylePropertiesKey
  >
  // JSDOM may return undefined for transition properties 获取样式属笥
  const getStyleProperties = (key: StylePropertiesKey) =>
    (styles[key] || '').split(', ')
  const transitionDelays = getStyleProperties(`${TRANSITION}Delay`)
  const transitionDurations = getStyleProperties(`${TRANSITION}Duration`)
  const transitionTimeout = getTimeout(transitionDelays, transitionDurations)
  const animationDelays = getStyleProperties(`${ANIMATION}Delay`)
  const animationDurations = getStyleProperties(`${ANIMATION}Duration`)
  const animationTimeout = getTimeout(animationDelays, animationDurations)

  let type: CSSTransitionInfo['type'] = null
  let timeout = 0
  let propCount = 0
  /* istanbul ignore if */
  if (expectedType === TRANSITION) {
    if (transitionTimeout > 0) {
      type = TRANSITION
      timeout = transitionTimeout
      propCount = transitionDurations.length
    }
  } else if (expectedType === ANIMATION) {
    if (animationTimeout > 0) {
      type = ANIMATION
      timeout = animationTimeout
      propCount = animationDurations.length
    }
  } else {
    timeout = Math.max(transitionTimeout, animationTimeout)
    type =
      timeout > 0
        ? transitionTimeout > animationTimeout
          ? TRANSITION
          : ANIMATION
        : null
    propCount = type
      ? type === TRANSITION
        ? transitionDurations.length
        : animationDurations.length
      : 0
  }
  const hasTransform =
    type === TRANSITION &&
    /\b(transform|all)(,|$)/.test(
      getStyleProperties(`${TRANSITION}Property`).toString()
    )
  return {
    type,
    timeout,
    propCount,
    hasTransform
  }
}
// 获取延时间时间
function getTimeout(delays: string[], durations: string[]): number {
  while (delays.length < durations.length) {
    delays = delays.concat(delays)
  }
  return Math.max(...durations.map((d, i) => toMs(d) + toMs(delays[i])))
}

// Old versions of Chromium (below 61.0.3163.100) formats floating pointer
// numbers in a locale-dependent way, using a comma instead of a dot.
// If comma is not replaced with a dot, the input will be rounded down
// (i.e. acting as a floor function) causing unexpected behaviors 替换指定的值或都返回 0 
function toMs(s: string): number {
  // #8409 default value for CSS durations can be 'auto'
  if (s === 'auto') return 0
  return Number(s.slice(0, -1).replace(',', '.')) * 1000
}

// synchronously force layout to put elements into a certain state 获取位置信息
export function forceReflow() {
  return document.body.offsetHeight
}
