import {
  VNode,
  normalizeVNode,
  VNodeProps,
  isSameVNodeType,
  openBlock,
  closeBlock,
  currentBlock,
  Comment,
  createVNode,
  isBlockTreeEnabled
} from '../vnode'
import { isFunction, isArray, ShapeFlags, toNumber } from '@vue/shared'
import { ComponentInternalInstance, handleSetupResult } from '../component'
import { Slots } from '../componentSlots'
import {
  RendererInternals,
  MoveType,
  SetupRenderEffectFn,
  RendererNode,
  RendererElement
} from '../renderer'
import { queuePostFlushCb } from '../scheduler'
import { filterSingleRoot, updateHOCHostEl } from '../componentRenderUtils'
import {
  pushWarningContext,
  popWarningContext,
  warn,
  assertNumber
} from '../warning'
import { handleError, ErrorCodes } from '../errorHandling'

export interface SuspenseProps {
  onResolve?: () => void
  onPending?: () => void
  onFallback?: () => void
  timeout?: string | number
  /**
   * Allow suspense to be captured by parent suspense
   *
   * @default false
   */
  suspensible?: boolean
}
// 判断是悬挂类型
export const isSuspense = (type: any): boolean => type.__isSuspense

// Suspense exposes a component-like API, and is treated like a component
// in the compiler, but internally it's a special built-in type that hooks
// directly into the renderer.
// 悬挂 TMPL
export const SuspenseImpl = {
  // 名称
  name: 'Suspense',
  // In order to make Suspense tree-shakable, we need to avoid importing it
  // directly in the renderer. The renderer checks for the __isSuspense flag
  // on a vnode's type and calls the `process` method, passing in renderer
  // internals.
  // 属性是悬挂
  __isSuspense: true,
  // 进程函数
  process(
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    slotScopeIds: string[] | null,
    optimized: boolean,
    // platform-specific impl passed from renderer
    rendererInternals: RendererInternals
  ) {
    // 如果n1 为 null
    if (n1 == null) {
      // 挂载悬挂
      mountSuspense(
        n2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        isSVG,
        slotScopeIds,
        optimized,
        rendererInternals
      )
    } else {
      // 更新悬挂
      patchSuspense(
        n1,
        n2,
        container,
        anchor,
        parentComponent,
        isSVG,
        slotScopeIds,
        optimized,
        rendererInternals
      )
    }
  },
  hydrate: hydrateSuspense,
  create: createSuspenseBoundary,
  normalize: normalizeSuspenseChildren
}

// Force-casted public typing for h and TSX props inference
export const Suspense = (__FEATURE_SUSPENSE__
  ? SuspenseImpl
  : null) as unknown as {
  __isSuspense: true
  new (): {
    $props: VNodeProps & SuspenseProps
    $slots: {
      default(): VNode[]
      fallback(): VNode[]
    }
  }
}
// 解发事件
function triggerEvent(
  vnode: VNode,
  name: 'onResolve' | 'onPending' | 'onFallback'
) {
  // 获取事件
  const eventListener = vnode.props && vnode.props[name]
  // 查看事件是函数
  if (isFunction(eventListener)) {
    // 事件监听
    eventListener()
  }
}
// 挂载悬挂函数
function mountSuspense(
  vnode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  slotScopeIds: string[] | null,
  optimized: boolean,
  rendererInternals: RendererInternals
) {
  // 解构更新函数 以及创建元素函数
  const {
    p: patch,
    o: { createElement }
  } = rendererInternals
  // 创建DIV
  const hiddenContainer = createElement('div');
  // 创建悬挂
  const suspense = (vnode.suspense = createSuspenseBoundary(
    vnode,
    parentSuspense,
    parentComponent,
    container,
    hiddenContainer,
    anchor,
    isSVG,
    slotScopeIds,
    optimized,
    rendererInternals
  ))

  // start mounting the content subtree in an off-dom container
  // 更新内容
  patch(
    null,
    (suspense.pendingBranch = vnode.ssContent!),
    hiddenContainer,
    null,
    parentComponent,
    suspense,
    isSVG,
    slotScopeIds
  )
  // now check if we have encountered any async deps
  // 如果挂载依赖大于 0 
  if (suspense.deps > 0) {
    // has async
    // invoke @fallback event
    // 触发事件
    triggerEvent(vnode, 'onPending')
    // 触发事件
    triggerEvent(vnode, 'onFallback')

    // mount the fallback tree
    // 挂载faback树
    patch(
      null,
      vnode.ssFallback!,
      container,
      anchor,
      parentComponent,
      null, // fallback tree will not have suspense context
      isSVG,
      slotScopeIds
    )
    // 设置活动分支
    setActiveBranch(suspense, vnode.ssFallback!)
  } else {
    // Suspense has no async deps. Just resolve.
    // 悬挂异步依赖
    suspense.resolve(false, true)
  }
}
// 更新悬挂
function patchSuspense(
  n1: VNode,
  n2: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  isSVG: boolean,
  slotScopeIds: string[] | null,
  optimized: boolean,
  { p: patch, um: unmount, o: { createElement } }: RendererInternals
) {
  // 获取悬挂内容
  const suspense = (n2.suspense = n1.suspense)!
  // 更新挂载节点指向
  suspense.vnode = n2
  // 更新元素指向
  n2.el = n1.el
  // 新分支内容
  const newBranch = n2.ssContent!
  // 新分支
  const newFallback = n2.ssFallback!
  // 解构活动分支，
  const { activeBranch, pendingBranch, isInFallback, isHydrating } = suspense
  // 待定分支为真
  if (pendingBranch) {
    // 悬挂的待定分支为新发支
    suspense.pendingBranch = newBranch
    // 如果新分支与待定分支为同
    if (isSameVNodeType(newBranch, pendingBranch)) {
      // same root type but content may have changed.
      // 更新分支内容
      patch(
        pendingBranch,
        newBranch,
        suspense.hiddenContainer,
        null,
        parentComponent,
        suspense,
        isSVG,
        slotScopeIds,
        optimized
      )
      // 如果悬挂依赖数大于0 个
      if (suspense.deps <= 0) {
        // 悬挂依赖 resolve函数执行
        suspense.resolve()
        // 如要是处理后备状态
      } else if (isInFallback) {
        // 更新内容
        patch(
          activeBranch,
          newFallback,
          container,
          anchor,
          parentComponent,
          null, // fallback tree will not have suspense context
          isSVG,
          slotScopeIds,
          optimized
        )
        // 设置活动分支
        setActiveBranch(suspense, newFallback)
      }
    } else {
      // toggled before pending tree is resolved
      // 悬挂待定ID自增 + 1
      suspense.pendingId++
      // 如果正在保湿
      if (isHydrating) {
        // if toggled before hydration is finished, the current DOM tree is
        // no longer valid. set it as the active branch so it will be unmounted
        // when resolved
        // 更新状态
        suspense.isHydrating = false
        // 更新活动分支为待定分支
        suspense.activeBranch = pendingBranch
      } else {
        // 解除组件安装
        unmount(pendingBranch, parentComponent, suspense)
      }
      // increment pending ID. this is used to invalidate async callbacks
      // reset suspense state
      // 依赖数设置为 0
      suspense.deps = 0
      // discard effects from pending branch
      // 副作用函数长度设置为 0
      suspense.effects.length = 0
      // discard previous container
      // 隐藏内容设置为创建的DIV
      suspense.hiddenContainer = createElement('div')
      // 如果后备状态
      if (isInFallback) {
        // already in fallback state
        // 更新内容
        patch(
          null,
          newBranch,
          suspense.hiddenContainer,
          null,
          parentComponent,
          suspense,
          isSVG,
          slotScopeIds,
          optimized
        )
        // 如果悬挂依赖不存在
        if (suspense.deps <= 0) {
          // 悬挂 resolve 执行
          suspense.resolve()
        } else {
          // 更新内容
          patch(
            activeBranch,
            newFallback,
            container,
            anchor,
            parentComponent,
            null, // fallback tree will not have suspense context
            isSVG,
            slotScopeIds,
            optimized
          )
          // 设置活动分支
          setActiveBranch(suspense, newFallback)
        }
        // 如果活动分支为真与是同一个节点类型
      } else if (activeBranch && isSameVNodeType(newBranch, activeBranch)) {
        // toggled "back" to current active branch
        // 更新内容
        patch(
          activeBranch,
          newBranch,
          container,
          anchor,
          parentComponent,
          suspense,
          isSVG,
          slotScopeIds,
          optimized
        )
        // force resolve
        // 悬挂 resolve 执行
        suspense.resolve(true)
      } else {
        // switched to a 3rd branch
        // 更新内容
        patch(
          null,
          newBranch,
          suspense.hiddenContainer,
          null,
          parentComponent,
          suspense,
          isSVG,
          slotScopeIds,
          optimized
        )
        // 如果悬挂依赖数小于  0
        if (suspense.deps <= 0) {
          suspense.resolve()
        }
      }
    }
  } else {
    // 如果活动分支为真与是同一个节点类型
    if (activeBranch && isSameVNodeType(newBranch, activeBranch)) {
      // root did not change, just normal patch
      // 更新内容
      patch(
        activeBranch,
        newBranch,
        container,
        anchor,
        parentComponent,
        suspense,
        isSVG,
        slotScopeIds,
        optimized
      )
      // 设置活动分支
      setActiveBranch(suspense, newBranch)
    } else {
      // root node toggled
      // invoke @pending event
      // 解发事件
      triggerEvent(n2, 'onPending')
      // mount pending branch in off-dom container
      // 悬挂 指向新分支
      suspense.pendingBranch = newBranch
      // 待定ID 自增
      suspense.pendingId++
      // 更新内容
      patch(
        null,
        newBranch,
        suspense.hiddenContainer,
        null,
        parentComponent,
        suspense,
        isSVG,
        slotScopeIds,
        optimized
      )
      // 如果悬挂依赖小于 0
      if (suspense.deps <= 0) {
        // incoming branch has no async deps, resolve now.
        suspense.resolve()
      } else {
        // 解构延时器与待定ID
        const { timeout, pendingId } = suspense
        // 如果延时大于 0
        if (timeout > 0) {
          setTimeout(() => {
            // 执行回调
            if (suspense.pendingId === pendingId) {
              suspense.fallback(newFallback)
            }
          }, timeout)
        } else if (timeout === 0) {
          // 执行回调
          suspense.fallback(newFallback)
        }
      }
    }
  }
}

export interface SuspenseBoundary {
  vnode: VNode<RendererNode, RendererElement, SuspenseProps>
  parent: SuspenseBoundary | null
  parentComponent: ComponentInternalInstance | null
  isSVG: boolean
  container: RendererElement
  hiddenContainer: RendererElement
  anchor: RendererNode | null
  activeBranch: VNode | null
  pendingBranch: VNode | null
  deps: number
  pendingId: number
  timeout: number
  isInFallback: boolean
  isHydrating: boolean
  isUnmounted: boolean
  effects: Function[]
  resolve(force?: boolean, sync?: boolean): void
  fallback(fallbackVNode: VNode): void
  move(
    container: RendererElement,
    anchor: RendererNode | null,
    type: MoveType
  ): void
  next(): RendererNode | null
  registerDep(
    instance: ComponentInternalInstance,
    setupRenderEffect: SetupRenderEffectFn
  ): void
  unmount(parentSuspense: SuspenseBoundary | null, doRemove?: boolean): void
}

let hasWarned = false
// 创建悬挂边界
function createSuspenseBoundary(
  vnode: VNode,
  parentSuspense: SuspenseBoundary | null,
  parentComponent: ComponentInternalInstance | null,
  container: RendererElement,
  hiddenContainer: RendererElement,
  anchor: RendererNode | null,
  isSVG: boolean,
  slotScopeIds: string[] | null,
  optimized: boolean,
  rendererInternals: RendererInternals,
  isHydrating = false
): SuspenseBoundary {
  /* istanbul ignore if */
  // 如果是开发环境与不是测试环境，与没有警告
  if (__DEV__ && !__TEST__ && !hasWarned) {
    hasWarned = true
    // @ts-ignore `console.info` cannot be null error
    console[console.info ? 'info' : 'log'](
      `<Suspense> is an experimental feature and its API will likely change.`
    )
  }
  // 解构更新方法移动方法，解除挂载方法，下一步方法
  const {
    p: patch,
    m: move,
    um: unmount,
    n: next,
    o: { parentNode, remove }
  } = rendererInternals

  // if set `suspensible: true`, set the current suspense as a dep of parent suspense
  let parentSuspenseId: number | undefined
  // 获取节点是否可悬挂
  const isSuspensible = isVNodeSuspensible(vnode)
  // 如果是悬挂为真，
  if (isSuspensible) {
    // 如果悬挂的待定分为真
    if (parentSuspense?.pendingBranch) {
      // 获取悬挂ID，
      parentSuspenseId = parentSuspense.pendingId
      // 悬挂依赖数自增
      parentSuspense.deps++
    }
  }
  // 获取延时指向
  const timeout = vnode.props ? toNumber(vnode.props.timeout) : undefined
  // 如果是开发环境
  if (__DEV__) {
    // 断言数字
    assertNumber(timeout, `Suspense timeout`)
  }
  // 悬挂对象
  const suspense: SuspenseBoundary = {
    vnode,
    parent: parentSuspense,
    parentComponent,
    isSVG,
    container,
    hiddenContainer,
    anchor,
    deps: 0,
    pendingId: 0,
    timeout: typeof timeout === 'number' ? timeout : -1,
    activeBranch: null,
    pendingBranch: null,
    isInFallback: true,
    isHydrating,
    isUnmounted: false,
    effects: [],
    // 解决方法
    resolve(resume = false, sync = false) {
      if (__DEV__) {
        if (!resume && !suspense.pendingBranch) {
          throw new Error(
            `suspense.resolve() is called without a pending branch.`
          )
        }
        if (suspense.isUnmounted) {
          throw new Error(
            `suspense.resolve() is called on an already unmounted suspense boundary.`
          )
        }
      }
      // 解构悬挂内容
      const {
        vnode,
        activeBranch,
        pendingBranch,
        pendingId,
        effects,
        parentComponent,
        container
      } = suspense
      // 如果悬挂正在保持中
      if (suspense.isHydrating) {
        // 更新状态
        suspense.isHydrating = false
        // 如果暂停状态为假时
      } else if (!resume) {
        // 如果活动分支为真，与待定分支转换为真，与待定分支转换 mode 为 out-in
        const delayEnter =
          activeBranch &&
          pendingBranch!.transition &&
          pendingBranch!.transition.mode === 'out-in'
          // 如果延入为真
        if (delayEnter) {
          // 活动分支转换的离开后事件
          activeBranch!.transition!.afterLeave = () => {
            if (pendingId === suspense.pendingId) {
              // 移除待定分支
              move(pendingBranch!, container, anchor, MoveType.ENTER)
            }
          }
        }
        // this is initial anchor on mount
        // 解构锚
        let { anchor } = suspense
        // unmount current active tree
        // 如要活动分支为真
        if (activeBranch) {
          // if the fallback tree was mounted, it may have been moved
          // as part of a parent suspense. get the latest anchor for insertion
          // 获取锚
          anchor = next(activeBranch)
          // 解除挂载
          unmount(activeBranch, parentComponent, suspense, true)
        }
        // 延入为假时
        if (!delayEnter) {
          // move content from off-dom container to actual container
          // 移除指定内容
          move(pendingBranch!, container, anchor, MoveType.ENTER)
        }
      }
      // 设置活动分支
      setActiveBranch(suspense, pendingBranch!)
      // 悬挂待定分支设置为空
      suspense.pendingBranch = null
      // 是
      suspense.isInFallback = false

      // flush buffered effects
      // check if there is a pending parent suspense
      // 获取parent
      let parent = suspense.parent
      // 
      let hasUnresolvedAncestor = false
      // 循环 parent 
      while (parent) {
        if (parent.pendingBranch) {
          // found a pending parent suspense, merge buffered post jobs
          // into that parent
          parent.effects.push(...effects)
          hasUnresolvedAncestor = true
          break
        }
        // 改变parent 指向
        parent = parent.parent
      }
      // no pending parent suspense, flush all jobs
      // 没有未解决的 Ancestor 
      if (!hasUnresolvedAncestor) {
        // 队列发送effects 方法
        queuePostFlushCb(effects)
      }
      // 悬挂的副作用方法设置空
      suspense.effects = []

      // resolve parent suspense if all async deps are resolved
      // 如果是悬挂
      if (isSuspensible) {
        // 如果
        if (
          parentSuspense &&
          parentSuspense.pendingBranch &&
          parentSuspenseId === parentSuspense.pendingId
        ) {
          // 悬挂依赖自减
          parentSuspense.deps--
          // 如果依赖为 与异步为假
          if (parentSuspense.deps === 0 && !sync) {
            parentSuspense.resolve()
          }
        }
      }

      // invoke @resolve event
      // 触发事件
      triggerEvent(vnode, 'onResolve')
    },
    // 回调方法
    fallback(fallbackVNode) {
      // 如果待定分支为假返回
      if (!suspense.pendingBranch) {
        return
      }
      // 解构节点活动分支，父组件，内容以及isSVG
      const { vnode, activeBranch, parentComponent, container, isSVG } =
        suspense

      // invoke @fallback event
      // 解发事件
      triggerEvent(vnode, 'onFallback')
      // 定义锚指向
      const anchor = next(activeBranch!)
      // 挂载回调
      const mountFallback = () => {
        if (!suspense.isInFallback) {
          return
        }
        // mount the fallback tree
        // 更新
        patch(
          null,
          fallbackVNode,
          container,
          anchor,
          parentComponent,
          null, // fallback tree will not have suspense context
          isSVG,
          slotScopeIds,
          optimized
        )
        // 设置活动分支
        setActiveBranch(suspense, fallbackVNode)
      }

      const delayEnter =
        fallbackVNode.transition && fallbackVNode.transition.mode === 'out-in'
      if (delayEnter) {
        activeBranch!.transition!.afterLeave = mountFallback
      }
      suspense.isInFallback = true

      // unmount current active branch
      // 解除当前分支
      unmount(
        activeBranch!,
        parentComponent,
        null, // no suspense so unmount hooks fire now
        true // shouldRemove
      )
        // 执行回调
      if (!delayEnter) {
        mountFallback()
      }
    },
    // 移动方法
    move(container, anchor, type) {
      suspense.activeBranch &&
        move(suspense.activeBranch, container, anchor, type)
      suspense.container = container
    },
    // 返回next的方法返回
    next() {
      return suspense.activeBranch && next(suspense.activeBranch)
    },
    // 注册依赖
    registerDep(instance, setupRenderEffect) {
      // 指向待定分支
      const isInPendingSuspense = !!suspense.pendingBranch
      if (isInPendingSuspense) {
        // 悬挂依赖自增
        suspense.deps++
      }
      // 指向节点元纱
      const hydratedEl = instance.vnode.el
      // 上下文对象的异步依赖捕获错误并抛出错误
      instance
        .asyncDep!.catch(err => {
          handleError(err, instance, ErrorCodes.SETUP_FUNCTION)
        })
        .then(asyncSetupResult => {
          // retry when the setup() promise resolves.
          // component may have been unmounted before resolve.
          if (
            instance.isUnmounted ||
            suspense.isUnmounted ||
            suspense.pendingId !== instance.suspenseId
          ) {
            // 返回空
            return
          }
          // retry from this component
          // 上下文对象的异步解决指向true
          instance.asyncResolved = true
          // 解构节点
          const { vnode } = instance
          // 如果开发环境为真
          if (__DEV__) {
            // 压入警告节点
            pushWarningContext(vnode)
          }
          // 手动安装状态
          handleSetupResult(instance, asyncSetupResult, false)
          // 特定元素
          if (hydratedEl) {
            // vnode may have been replaced if an update happened before the
            // async dep is resolved.
            // 节点元素指向特定元素
            vnode.el = hydratedEl
          }
          // 占位内谷指向元素
          const placeholder = !hydratedEl && instance.subTree.el
          // 安装渲染副作用函数
          setupRenderEffect(
            instance,
            vnode,
            // component may have been moved before resolve.
            // if this is not a hydration, instance.subTree will be the comment
            // placeholder.
            parentNode(hydratedEl || instance.subTree.el!)!,
            // anchor will not be used if this is hydration, so only need to
            // consider the comment placeholder case.
            hydratedEl ? null : next(instance.subTree),
            suspense,
            isSVG,
            optimized
          )
          // 如果占位符为真
          if (placeholder) {
            // 移除占位符
            remove(placeholder)
          }
          // 更新host 元素
          updateHOCHostEl(instance, vnode.el)
          // 如果开发环境为真
          if (__DEV__) {
            // 弹警告内容
            popWarningContext()
          }
          // only decrease deps count if suspense is not already resolved
          // 如果是 悬而未决为真与自减依赖为  0 为真时
          if (isInPendingSuspense && --suspense.deps === 0) {
            // 悬挂 resolve 函数执行
            suspense.resolve()
          }
        })
    },
    // 解除挂载
    unmount(parentSuspense, doRemove) {
      suspense.isUnmounted = true
      if (suspense.activeBranch) {
        unmount(
          suspense.activeBranch,
          parentComponent,
          parentSuspense,
          doRemove
        )
      }
      if (suspense.pendingBranch) {
        unmount(
          suspense.pendingBranch,
          parentComponent,
          parentSuspense,
          doRemove
        )
      }
    }
  }
  // 返回悬挂
  return suspense
}
// 水合物悬挂
function hydrateSuspense(
  node: Node,
  vnode: VNode,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  slotScopeIds: string[] | null,
  optimized: boolean,
  rendererInternals: RendererInternals,
  hydrateNode: (
    node: Node,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => Node | null
): Node | null {
  /* eslint-disable no-restricted-globals */
  // 悬挂边界
  const suspense = (vnode.suspense = createSuspenseBoundary(
    vnode,
    parentSuspense,
    parentComponent,
    node.parentNode!,
    document.createElement('div'),
    null,
    isSVG,
    slotScopeIds,
    optimized,
    rendererInternals,
    true /* hydrating */
  ))
  // there are two possible scenarios for server-rendered suspense:
  // - success: ssr content should be fully resolved
  // - failure: ssr content should be the fallback branch.
  // however, on the client we don't really know if it has failed or not
  // attempt to hydrate the DOM assuming it has succeeded, but we still
  // need to construct a suspense boundary first
  // 湿节点函数执行
  const result = hydrateNode(
    node,
    (suspense.pendingBranch = vnode.ssContent!),
    parentComponent,
    suspense,
    slotScopeIds,
    optimized
  )
  if (suspense.deps === 0) {
    suspense.resolve(false, true)
  }

  // 返回状态
  return result
  /* eslint-enable no-restricted-globals */
}
// 正常化悬挂子元素
function normalizeSuspenseChildren(vnode: VNode) {
  const { shapeFlag, children } = vnode
  const isSlotChildren = shapeFlag & ShapeFlags.SLOTS_CHILDREN
  vnode.ssContent = normalizeSuspenseSlot(
    isSlotChildren ? (children as Slots).default : children
  )
  vnode.ssFallback = isSlotChildren
    ? normalizeSuspenseSlot((children as Slots).fallback)
    : createVNode(Comment)
}
// 正常化悬挂插糟
function normalizeSuspenseSlot(s: any) {
  let block: VNode[] | null | undefined
  if (isFunction(s)) {
    const trackBlock = isBlockTreeEnabled && s._c
    if (trackBlock) {
      // disableTracking: false
      // allow block tracking for compiled slots
      // (see ./componentRenderContext.ts)
      s._d = false
      openBlock()
    }
    s = s()
    if (trackBlock) {
      s._d = true
      block = currentBlock
      closeBlock()
    }
  }
  if (isArray(s)) {
    const singleChild = filterSingleRoot(s)
    if (__DEV__ && !singleChild) {
      warn(`<Suspense> slots expect a single root node.`)
    }
    s = singleChild
  }
  s = normalizeVNode(s)
  if (block && !s.dynamicChildren) {
    s.dynamicChildren = block.filter(c => c !== s)
  }
  return s
}
// 队列副作用函数悬挂
export function queueEffectWithSuspense(
  fn: Function | Function[],
  suspense: SuspenseBoundary | null
): void {
  if (suspense && suspense.pendingBranch) {
    if (isArray(fn)) {
      suspense.effects.push(...fn)
    } else {
      suspense.effects.push(fn)
    }
  } else {
    queuePostFlushCb(fn)
  }
}
// 设置活动分支
function setActiveBranch(suspense: SuspenseBoundary, branch: VNode) {
  suspense.activeBranch = branch
  const { vnode, parentComponent } = suspense
  const el = (vnode.el = branch.el)
  // in case suspense is the root node of a component,
  // recursively update the HOC el
  if (parentComponent && parentComponent.subTree === vnode) {
    parentComponent.vnode.el = el
    updateHOCHostEl(parentComponent, el)
  }
}
// 是节点悬挂
function isVNodeSuspensible(vnode: VNode) {
  return vnode.props?.suspensible != null && vnode.props.suspensible !== false
}
