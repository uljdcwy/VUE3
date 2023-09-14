import {
  TransitionProps,
  addTransitionClass,
  removeTransitionClass,
  ElementWithTransition,
  getTransitionInfo,
  resolveTransitionProps,
  TransitionPropsValidators,
  forceReflow
} from './Transition'
import {
  Fragment,
  VNode,
  warn,
  resolveTransitionHooks,
  useTransitionState,
  getTransitionRawChildren,
  getCurrentInstance,
  setTransitionHooks,
  createVNode,
  onUpdated,
  SetupContext,
  toRaw,
  compatUtils,
  DeprecationTypes,
  ComponentOptions
} from '@vue/runtime-core'
import { extend } from '@vue/shared'

const positionMap = new WeakMap<VNode, DOMRect>()
const newPositionMap = new WeakMap<VNode, DOMRect>()

export type TransitionGroupProps = Omit<TransitionProps, 'mode'> & {
  tag?: string
  moveClass?: string
}
// 过渡组impl
const TransitionGroupImpl: ComponentOptions = {
  name: 'TransitionGroup',
  // 属性指向扩展的对象
  props: /*#__PURE__*/ extend({}, TransitionPropsValidators, {
    tag: String,
    moveClass: String
  }),
  // 安装方法
  setup(props: TransitionGroupProps, { slots }: SetupContext) {
    // 获取上下文对象
    const instance = getCurrentInstance()!
    // 获取使用过度状态
    const state = useTransitionState()
    let prevChildren: VNode[]
    let children: VNode[]
    // 更新触发事件
    onUpdated(() => {
      // children is guaranteed to exist after initial render 前置子元素不存在返回
      if (!prevChildren.length) {
        return
      }
      // 移动类指向
      const moveClass = props.moveClass || `${props.name || 'v'}-move`
      // 没有CSS过渡 返回
      if (
        !hasCSSTransform(
          prevChildren[0].el as ElementWithTransition,
          instance.vnode.el as Node,
          moveClass
        )
      ) {
        return
      }

      // we divide the work into three loops to avoid mixing DOM reads and writes
      // in each iteration - which helps prevent layout thrashing. 前置子元素回调方法
      prevChildren.forEach(callPendingCbs)
      // 前置子元素循环传入回调
      prevChildren.forEach(recordPosition)
      // 过虑指定的子元素
      const movedChildren = prevChildren.filter(applyTranslation)

      // force reflow to put everything in position  获取位置
      forceReflow()
      // 移动子元素循环
      movedChildren.forEach(c => {
        const el = c.el as ElementWithTransition
        const style = el.style
        // 添加过渡类
        addTransitionClass(el, moveClass)
        style.transform = style.webkitTransform = style.transitionDuration = ''
        // 过渡回调
        const cb = ((el as any)._moveCb = (e: TransitionEvent) => {
          if (e && e.target !== el) {
            return
          }
          if (!e || /transform$/.test(e.propertyName)) {
            // 移除过度渡听
            el.removeEventListener('transitionend', cb)
            ;(el as any)._moveCb = null
            removeTransitionClass(el, moveClass)
          }
        })
        // 添加过渡监听
        el.addEventListener('transitionend', cb)
      })
    })
    // 返回方法
    return () => {
      // 解除晌应
      const rawProps = toRaw(props)
      // 解析过渡属性
      const cssTransitionProps = resolveTransitionProps(rawProps)
      // 标答指向
      let tag = rawProps.tag || Fragment

      if (
        __COMPAT__ &&
        !rawProps.tag &&
        compatUtils.checkCompatEnabled(
          DeprecationTypes.TRANSITION_GROUP_ROOT,
          instance.parent
        )
      ) {
        tag = 'span'
      }
      // 前置子元素指向
      prevChildren = children
      // 子元素指向 
      children = slots.default ? getTransitionRawChildren(slots.default()) : []

      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (child.key != null) {
          // 设置过渡勾子
          setTransitionHooks(
            child,
            // 解析过渡勾子
            resolveTransitionHooks(child, cssTransitionProps, state, instance)
          )
        } else if (__DEV__) {
          warn(`<TransitionGroup> children must be keyed.`)
        }
      }
      // 如果前置子元纱为真
      if (prevChildren) {
        for (let i = 0; i < prevChildren.length; i++) {
          const child = prevChildren[i]
          // 设置过渡勾子
          setTransitionHooks(
            child,
            resolveTransitionHooks(child, cssTransitionProps, state, instance)
          )
          // 位置记录
          positionMap.set(child, (child.el as Element).getBoundingClientRect())
        }
      }
      // 返回创建的节点
      return createVNode(tag, null, children)
    }
  }
}
// 如果兼容为真 设置属性
if (__COMPAT__) {
  TransitionGroupImpl.__isBuiltIn = true
}

/**
 * TransitionGroup does not support "mode" so we need to remove it from the
 * props declarations, but direct delete operation is considered a side effect
 * and will make the entire transition feature non-tree-shakeable, so we do it
 * in a function and mark the function's invocation as pure.
 */
// 移除节点
const removeMode = (props: any) => delete props.mode
/*#__PURE__*/ removeMode(TransitionGroupImpl.props)

export const TransitionGroup = TransitionGroupImpl as unknown as {
  new (): {
    $props: TransitionGroupProps
  }
}

function callPendingCbs(c: VNode) {
  const el = c.el as any
  if (el._moveCb) {
    el._moveCb()
  }
  if (el._enterCb) {
    el._enterCb()
  }
}

function recordPosition(c: VNode) {
  newPositionMap.set(c, (c.el as Element).getBoundingClientRect())
}

function applyTranslation(c: VNode): VNode | undefined {
  const oldPos = positionMap.get(c)!
  const newPos = newPositionMap.get(c)!
  const dx = oldPos.left - newPos.left
  const dy = oldPos.top - newPos.top
  if (dx || dy) {
    const s = (c.el as HTMLElement).style
    s.transform = s.webkitTransform = `translate(${dx}px,${dy}px)`
    s.transitionDuration = '0s'
    return c
  }
}
// 判断有CSS转换
function hasCSSTransform(
  el: ElementWithTransition,
  root: Node,
  moveClass: string
): boolean {
  // Detect whether an element with the move class applied has
  // CSS transitions. Since the element may be inside an entering
  // transition at this very moment, we make a clone of it and remove
  // all other transition classes applied to ensure only the move class
  // is applied. 克隆节点
  const clone = el.cloneNode() as HTMLElement
  if (el._vtc) {
    el._vtc.forEach(cls => {
      cls.split(/\s+/).forEach(c => c && clone.classList.remove(c))
    })
  }
  moveClass.split(/\s+/).forEach(c => c && clone.classList.add(c))
  clone.style.display = 'none'
  // 内容指向
  const container = (
    root.nodeType === 1 ? root : root.parentNode
  ) as HTMLElement
  // 内容添加克隆节点
  container.appendChild(clone)
  // 获取过渡信息
  const { hasTransform } = getTransitionInfo(clone)
  // 内容中移除子节点
  container.removeChild(clone)
  // 返回方法
  return hasTransform
}
