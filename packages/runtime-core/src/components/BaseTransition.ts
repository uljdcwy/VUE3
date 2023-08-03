import {
  getCurrentInstance,
  SetupContext,
  ComponentInternalInstance,
  ComponentOptions
} from '../component'
import {
  cloneVNode,
  Comment,
  isSameVNodeType,
  VNode,
  VNodeArrayChildren,
  Fragment
} from '../vnode'
import { warn } from '../warning'
import { isKeepAlive } from './KeepAlive'
import { toRaw } from '@vue/reactivity'
import { callWithAsyncErrorHandling, ErrorCodes } from '../errorHandling'
import { ShapeFlags, PatchFlags, isArray } from '@vue/shared'
import { onBeforeUnmount, onMounted } from '../apiLifecycle'
import { RendererElement } from '../renderer'

type Hook<T = () => void> = T | T[]
// 基本转换属性
export interface BaseTransitionProps<HostElement = RendererElement> {
  mode?: 'in-out' | 'out-in' | 'default'
  appear?: boolean

  // If true, indicates this is a transition that doesn't actually insert/remove
  // the element, but toggles the show / hidden status instead.
  // The transition hooks are injected, but will be skipped by the renderer.
  // Instead, a custom directive can control the transition by calling the
  // injected hooks (e.g. v-show).
  persisted?: boolean

  // Hooks. Using camel case for easier usage in render functions & JSX.
  // In templates these can be written as @before-enter="xxx" as prop names
  // are camelized.
  onBeforeEnter?: Hook<(el: HostElement) => void>
  onEnter?: Hook<(el: HostElement, done: () => void) => void>
  onAfterEnter?: Hook<(el: HostElement) => void>
  onEnterCancelled?: Hook<(el: HostElement) => void>
  // leave
  onBeforeLeave?: Hook<(el: HostElement) => void>
  onLeave?: Hook<(el: HostElement, done: () => void) => void>
  onAfterLeave?: Hook<(el: HostElement) => void>
  onLeaveCancelled?: Hook<(el: HostElement) => void> // only fired in persisted mode
  // appear
  onBeforeAppear?: Hook<(el: HostElement) => void>
  onAppear?: Hook<(el: HostElement, done: () => void) => void>
  onAfterAppear?: Hook<(el: HostElement) => void>
  onAppearCancelled?: Hook<(el: HostElement) => void>
}
// 动画勾子
export interface TransitionHooks<HostElement = RendererElement> {
  mode: BaseTransitionProps['mode']
  persisted: boolean
  beforeEnter(el: HostElement): void
  enter(el: HostElement): void
  leave(el: HostElement, remove: () => void): void
  clone(vnode: VNode): TransitionHooks<HostElement>
  // optional
  afterLeave?(): void
  delayLeave?(
    el: HostElement,
    earlyRemove: () => void,
    delayedLeave: () => void
  ): void
  delayedLeave?(): void
}
// 转换勾子Caller
export type TransitionHookCaller = <T extends any[] = [el: any]>(
  hook: Hook<(...args: T) => void> | undefined,
  args?: T
) => void
// 
export type PendingCallback = (cancelled?: boolean) => void
// 转换状态
export interface TransitionState {
  isMounted: boolean
  isLeaving: boolean
  isUnmounting: boolean
  // Track pending leave callbacks for children of the same key.
  // This is used to force remove leaving a child when a new copy is entering.
  leavingVNodes: Map<any, Record<string, VNode>>
}
// 转换元素
export interface TransitionElement {
  // in persisted mode (e.g. v-show), the same element is toggled, so the
  // pending enter/leave callbacks may need to be cancelled if the state is toggled
  // before it finishes.
  _enterCb?: PendingCallback
  _leaveCb?: PendingCallback
}
// 使用转换的state
export function useTransitionState(): TransitionState {
  const state: TransitionState = {
    isMounted: false,
    isLeaving: false,
    isUnmounting: false,
    leavingVNodes: new Map()
  }
  // 页面挂载时改变挂载状态
  onMounted(() => {
    state.isMounted = true
  })
  // 页面解除挂载前改变状态
  onBeforeUnmount(() => {
    state.isUnmounting = true
  })
  // 返回state
  return state
}

const TransitionHookValidator = [Function, Array]

export const BaseTransitionPropsValidators = {
  mode: String,
  appear: Boolean,
  persisted: Boolean,
  // enter
  onBeforeEnter: TransitionHookValidator,
  onEnter: TransitionHookValidator,
  onAfterEnter: TransitionHookValidator,
  onEnterCancelled: TransitionHookValidator,
  // leave
  onBeforeLeave: TransitionHookValidator,
  onLeave: TransitionHookValidator,
  onAfterLeave: TransitionHookValidator,
  onLeaveCancelled: TransitionHookValidator,
  // appear
  onBeforeAppear: TransitionHookValidator,
  onAppear: TransitionHookValidator,
  onAfterAppear: TransitionHookValidator,
  onAppearCancelled: TransitionHookValidator
}
// 基本转换Impl
const BaseTransitionImpl: ComponentOptions = {
  // 基本转换
  name: `BaseTransition`,
  // 属性
  props: BaseTransitionPropsValidators,
  // 安装方法
  setup(props: BaseTransitionProps, { slots }: SetupContext) {
    // 获取当前的上下文对象
    const instance = getCurrentInstance()!
    // 使用转换的状态
    const state = useTransitionState()
    // 前置转换的键
    let prevTransitionKey: any

    return () => {
      // 获取转换的子元素
      const children =
        slots.default && getTransitionRawChildren(slots.default(), true)
      // 如果子元素为假或者子元素长度为假
        if (!children || !children.length) {
        return
      }
      // 获取第一个子元素
      let child: VNode = children[0]
      // 如果有多个子元素
      if (children.length > 1) {
        let hasFound = false
        // locate first non-comment child
        // 循环子元纱
        for (const c of children) {
          // 如果元素类型为  Comment
          if (c.type !== Comment) {
            // 如果是开发环境与有 Found 输入警告
            if (__DEV__ && hasFound) {
              // warn more than one non-comment child
              warn(
                '<transition> 只适用于转换单个的组件与元素. ' +
                  '用 <transition-group> 循环列表.'
              )
              break
            }
            child = c
            hasFound = true
            // 不是开发环境跳出循环
            if (!__DEV__) break
          }
        }
      }

      // there's no need to track reactivity for these props so use the raw
      // props for a bit better perf
      // 解除晌应属性
      const rawProps = toRaw(props)
      // 解构mode
      const { mode } = rawProps
      // check mode
      // 检查model 如果model属性为真并且不是指定属性输入警告
      if (
        __DEV__ &&
        mode &&
        mode !== 'in-out' &&
        mode !== 'out-in' &&
        mode !== 'default'
      ) {
        warn(`验证属性 <transition> 模式: ${mode}`)
      }
      // 如果是离开状态
      if (state.isLeaving) {
        // 返回节点的子节点状态
        return emptyPlaceholder(child)
      }

      // in the case of <transition><keep-alive/></transition>, we need to
      // compare the type of the kept-alive children.
      // 获取缓存组件的子元素
      const innerChild = getKeepAliveChild(child)
      // 如果在入场子元素为假
      if (!innerChild) {
        return emptyPlaceholder(child)
      }
      // 解决过度挂钩
      const enterHooks = resolveTransitionHooks(
        innerChild,
        rawProps,
        state,
        instance
      )
      // 设置过度钩子
      setTransitionHooks(innerChild, enterHooks)

      // 获取上下文对象的子树
      const oldChild = instance.subTree
      // 获取静态子元素的内容元素
      const oldInnerChild = oldChild && getKeepAliveChild(oldChild)
      // 转换键改变时状态
      let transitionKeyChanged = false
      // 解构获取过度的键
      const { getTransitionKey } = innerChild.type as any
      // 如果获取过度的键为真
      if (getTransitionKey) {
        // 获取过度的键
        const key = getTransitionKey()
        // 如果前置过度的争冠为undefined
        if (prevTransitionKey === undefined) {
          // 转鬼凤指向
          prevTransitionKey = key
        } else if (key !== prevTransitionKey) {
          // 前置过度的键指向key
          prevTransitionKey = key
          // 过度key改变设置为true
          transitionKeyChanged = true
        }
      }

      // handle mode
      // 手动 mode 如果旧内容子元素为真与类型不为  Comment  与不是同一节点类型或都转换键改变为假
      if (
        oldInnerChild &&
        oldInnerChild.type !== Comment &&
        (!isSameVNodeType(innerChild, oldInnerChild) || transitionKeyChanged)
      ) {
        // 解决过度钩子
        const leavingHooks = resolveTransitionHooks(
          oldInnerChild,
          rawProps,
          state,
          instance
        )
        // update old tree's hooks in case of dynamic transition
        // 设置过度勾子
        setTransitionHooks(oldInnerChild, leavingHooks)
        // switching between different views
        // 如果mode 为 out-in
        if (mode === 'out-in') {
          // 离开状态设置为 true
          state.isLeaving = true
          // return placeholder node and queue update when leave finishes
          // 离开勾子，离开函数设置
          leavingHooks.afterLeave = () => {
            state.isLeaving = false
            // #6835
            // it also needs to be updated when active is undefined
            if (instance.update.active !== false) {
              instance.update()
            }
          }
          // 返回空
          return emptyPlaceholder(child)
          // 如果model 为in-out 与节点类型不为 Comment
        } else if (mode === 'in-out' && innerChild.type !== Comment) {
          // 离开勾子的延时离开指向方法
          leavingHooks.delayLeave = (
            el: TransitionElement,
            earlyRemove,
            delayedLeave
          ) => {
            const leavingVNodesCache = getLeavingNodesForType(
              state,
              oldInnerChild
            )
            leavingVNodesCache[String(oldInnerChild.key)] = oldInnerChild
            // early removal callback
            el._leaveCb = () => {
              earlyRemove()
              el._leaveCb = undefined
              delete enterHooks.delayedLeave
            }
            enterHooks.delayedLeave = delayedLeave
          }
        }
      }
      // 返回子元素
      return child
    }
  }
}

if (__COMPAT__) {
  BaseTransitionImpl.__isBuiltIn = true
}

// export the public type for h/tsx inference
// also to avoid inline import() in generated d.ts files
// 声名new 类型
export const BaseTransition = BaseTransitionImpl as unknown as {
  new (): {
    $props: BaseTransitionProps<any>
    $slots: {
      default(): VNode[]
    }
  }
}
// 获取离开的节点循环类型
function getLeavingNodesForType(
  state: TransitionState,
  vnode: VNode
): Record<string, VNode> {
  // 指向离开节点
  const { leavingVNodes } = state
  // 离开节点缓存指向
  let leavingVNodesCache = leavingVNodes.get(vnode.type)!
  // 如果为假
  if (!leavingVNodesCache) {
    leavingVNodesCache = Object.create(null)
    leavingVNodes.set(vnode.type, leavingVNodesCache)
  }
  // 返回获取的节点缓存
  return leavingVNodesCache
}

// The transition hooks are attached to the vnode as vnode.transition
// and will be called at appropriate timing in the renderer.
// 解决转换钩子
export function resolveTransitionHooks(
  vnode: VNode,
  props: BaseTransitionProps<any>,
  state: TransitionState,
  instance: ComponentInternalInstance
): TransitionHooks {
  // 解构属性中的内容
  const {
    appear,
    mode,
    persisted = false,
    onBeforeEnter,
    onEnter,
    onAfterEnter,
    onEnterCancelled,
    onBeforeLeave,
    onLeave,
    onAfterLeave,
    onLeaveCancelled,
    onBeforeAppear,
    onAppear,
    onAfterAppear,
    onAppearCancelled
  } = props;
  // 节点字符串化的键
  const key = String(vnode.key)
  // 获取离开时节点循环类型
  const leavingVNodesCache = getLeavingNodesForType(state, vnode)
  // 搪行钩子指向函数
  const callHook: TransitionHookCaller = (hook, args) => {
    hook &&
      callWithAsyncErrorHandling(
        hook,
        instance,
        ErrorCodes.TRANSITION_HOOK,
        args
      )
  }
  // 执行异步钩子指向函数
  const callAsyncHook = (
    hook: Hook<(el: any, done: () => void) => void>,
    args: [TransitionElement, () => void]
  ) => {
    const done = args[1]
    callHook(hook, args)
    if (isArray(hook)) {
      if (hook.every(hook => hook.length <= 1)) done()
    } else if (hook.length <= 1) {
      done()
    }
  }
  // 构子方法定义
  const hooks: TransitionHooks<TransitionElement> = {
    mode,
    persisted,
    beforeEnter(el) {
      let hook = onBeforeEnter
      if (!state.isMounted) {
        if (appear) {
          hook = onBeforeAppear || onBeforeEnter
        } else {
          return
        }
      }
      // for same element (v-show)
      if (el._leaveCb) {
        el._leaveCb(true /* cancelled */)
      }
      // for toggled element with same key (v-if)
      const leavingVNode = leavingVNodesCache[key]
      if (
        leavingVNode &&
        isSameVNodeType(vnode, leavingVNode) &&
        leavingVNode.el!._leaveCb
      ) {
        // force early removal (not cancelled)
        leavingVNode.el!._leaveCb()
      }
      callHook(hook, [el])
    },

    enter(el) {
      let hook = onEnter
      let afterHook = onAfterEnter
      let cancelHook = onEnterCancelled
      if (!state.isMounted) {
        if (appear) {
          hook = onAppear || onEnter
          afterHook = onAfterAppear || onAfterEnter
          cancelHook = onAppearCancelled || onEnterCancelled
        } else {
          return
        }
      }
      let called = false
      const done = (el._enterCb = (cancelled?) => {
        if (called) return
        called = true
        if (cancelled) {
          callHook(cancelHook, [el])
        } else {
          callHook(afterHook, [el])
        }
        if (hooks.delayedLeave) {
          hooks.delayedLeave()
        }
        el._enterCb = undefined
      })
      if (hook) {
        callAsyncHook(hook, [el, done])
      } else {
        done()
      }
    },

    leave(el, remove) {
      const key = String(vnode.key)
      if (el._enterCb) {
        el._enterCb(true /* cancelled */)
      }
      if (state.isUnmounting) {
        return remove()
      }
      callHook(onBeforeLeave, [el])
      let called = false
      const done = (el._leaveCb = (cancelled?) => {
        if (called) return
        called = true
        remove()
        if (cancelled) {
          callHook(onLeaveCancelled, [el])
        } else {
          callHook(onAfterLeave, [el])
        }
        el._leaveCb = undefined
        if (leavingVNodesCache[key] === vnode) {
          delete leavingVNodesCache[key]
        }
      })
      leavingVNodesCache[key] = vnode
      if (onLeave) {
        callAsyncHook(onLeave, [el, done])
      } else {
        done()
      }
    },

    clone(vnode) {
      return resolveTransitionHooks(vnode, props, state, instance)
    }
  }
  // 返回钩子定义
  return hooks
}

// the placeholder really only handles one special case: KeepAlive
// in the case of a KeepAlive in a leave phase we need to return a KeepAlive
// placeholder with empty content to avoid the KeepAlive instance from being
// unmounted.
// 如果是静态组件返回克隆节点
function emptyPlaceholder(vnode: VNode): VNode | undefined {
  if (isKeepAlive(vnode)) {
    vnode = cloneVNode(vnode)
    vnode.children = null
    return vnode
  }
}
// 获取静态缓存子节点
function getKeepAliveChild(vnode: VNode): VNode | undefined {
  return isKeepAlive(vnode)
    ? vnode.children
      ? ((vnode.children as VNodeArrayChildren)[0] as VNode)
      : undefined
    : vnode
}
// 设置过度的钩子
export function setTransitionHooks(vnode: VNode, hooks: TransitionHooks) {
  if (vnode.shapeFlag & ShapeFlags.COMPONENT && vnode.component) {
    setTransitionHooks(vnode.component.subTree, hooks)
  } else if (__FEATURE_SUSPENSE__ && vnode.shapeFlag & ShapeFlags.SUSPENSE) {
    vnode.ssContent!.transition = hooks.clone(vnode.ssContent!)
    vnode.ssFallback!.transition = hooks.clone(vnode.ssFallback!)
  } else {
    vnode.transition = hooks
  }
}
// 获取过渡原子元素
export function getTransitionRawChildren(
  children: VNode[],
  keepComment: boolean = false,
  parentKey?: VNode['key']
): VNode[] {
  let ret: VNode[] = []
  let keyedFragmentCount = 0
  for (let i = 0; i < children.length; i++) {
    let child = children[i]
    // #5360 inherit parent key in case of <template v-for>
    const key =
      parentKey == null
        ? child.key
        : String(parentKey) + String(child.key != null ? child.key : i)
    // handle fragment children case, e.g. v-for
    if (child.type === Fragment) {
      if (child.patchFlag & PatchFlags.KEYED_FRAGMENT) keyedFragmentCount++
      ret = ret.concat(
        getTransitionRawChildren(child.children as VNode[], keepComment, key)
      )
    }
    // comment placeholders should be skipped, e.g. v-if
    else if (keepComment || child.type !== Comment) {
      ret.push(key != null ? cloneVNode(child, { key }) : child)
    }
  }
  // #1126 if a transition children list contains multiple sub fragments, these
  // fragments will be merged into a flat children array. Since each v-for
  // fragment may contain different static bindings inside, we need to de-op
  // these children to force full diffs to ensure correct behavior.
  if (keyedFragmentCount > 1) {
    for (let i = 0; i < ret.length; i++) {
      ret[i].patchFlag = PatchFlags.BAIL
    }
  }
  return ret
}
