import {
  ConcreteComponent,
  getCurrentInstance,
  SetupContext,
  ComponentInternalInstance,
  currentInstance,
  getComponentName,
  ComponentOptions
} from '../component'
import {
  VNode,
  cloneVNode,
  isVNode,
  VNodeProps,
  invokeVNodeHook,
  isSameVNodeType
} from '../vnode'
import { warn } from '../warning'
import {
  onBeforeUnmount,
  injectHook,
  onUnmounted,
  onMounted,
  onUpdated
} from '../apiLifecycle'
import {
  isString,
  isArray,
  isRegExp,
  ShapeFlags,
  remove,
  invokeArrayFns
} from '@vue/shared'
import { watch } from '../apiWatch'
import {
  RendererInternals,
  queuePostRenderEffect,
  MoveType,
  RendererElement,
  RendererNode
} from '../renderer'
import { setTransitionHooks } from './BaseTransition'
import { ComponentRenderContext } from '../componentPublicInstance'
import { devtoolsComponentAdded } from '../devtools'
import { isAsyncWrapper } from '../apiAsyncComponent'
import { isSuspense } from './Suspense'
import { LifecycleHooks } from '../enums'

type MatchPattern = string | RegExp | (string | RegExp)[]

export interface KeepAliveProps {
  include?: MatchPattern
  exclude?: MatchPattern
  max?: number | string
}

type CacheKey = string | number | symbol | ConcreteComponent
type Cache = Map<CacheKey, VNode>
type Keys = Set<CacheKey>

export interface KeepAliveContext extends ComponentRenderContext {
  renderer: RendererInternals
  activate: (
    vnode: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    isSVG: boolean,
    optimized: boolean
  ) => void
  deactivate: (vnode: VNode) => void
}
// 判断是缓存组件
export const isKeepAlive = (vnode: VNode): boolean =>
  (vnode.type as any).__isKeepAlive
// 缓存组件对象
const KeepAliveImpl: ComponentOptions = {
  // 名称属性
  name: `KeepAlive`,

  // Marker for special handling inside the renderer. We are not using a ===
  // check directly on KeepAlive in the renderer, because importing it directly
  // would prevent it from being tree-shaken.
  // 是缓存组件
  __isKeepAlive: true,
  // 属性元组
  props: {
    include: [String, RegExp, Array],
    exclude: [String, RegExp, Array],
    max: [String, Number]
  },
  // 安装方法
  setup(props: KeepAliveProps, { slots }: SetupContext) {
    // 获取当前上下文对象
    const instance = getCurrentInstance()!
    // KeepAlive communicates with the instantiated renderer via the
    // ctx where the renderer passes in its internals,
    // and the KeepAlive instance exposes activate/deactivate implementations.
    // The whole point of this is to avoid importing KeepAlive directly in the
    // renderer to facilitate tree-shaking.
    // 获取当前上下文对象句柄
    const sharedContext = instance.ctx as KeepAliveContext

    // if the internal renderer is not registered, it indicates that this is server-side rendering,
    // for KeepAlive, we just need to render its children
    // 如果是SSR 与上下文对象渲染器不为真
    if (__SSR__ && !sharedContext.renderer) {
      // 返回函数
      return () => {
        const children = slots.default && slots.default()
        return children && children.length === 1 ? children[0] : children
      }
    }
    // 设置缓存对象
    const cache: Cache = new Map()
    // 设置键对象
    const keys: Keys = new Set()
    // 当前指向空
    let current: VNode | null = null
    // 如果是开发环境或者  为真 缓存指向缓存
    if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
      ;(instance as any).__v_cache = cache
    }
    // 指向上下文对象的 suspense
    const parentSuspense = instance.suspense
    // 解构循渲对象，解构p 方法m 方法un方法o方法
    const {
      renderer: {
        p: patch,
        m: move,
        um: _unmount,
        o: { createElement }
      }
    } = sharedContext
    // 创建元素
    const storageContainer = createElement('div')
    // 上下文对象活动指向方法
    sharedContext.activate = (vnode, container, anchor, isSVG, optimized) => {
      // 获取节点组件
      const instance = vnode.component!
      // 移动挂载组件
      move(vnode, container, anchor, MoveType.ENTER, parentSuspense)
      // in case props have changed
      // 更新组件类型
      patch(
        instance.vnode,
        vnode,
        container,
        anchor,
        instance,
        parentSuspense,
        isSVG,
        vnode.slotScopeIds,
        optimized
      )
      // 队列发送渲染晌应
      queuePostRenderEffect(() => {
        instance.isDeactivated = false
        if (instance.a) {
          invokeArrayFns(instance.a)
        }
        const vnodeHook = vnode.props && vnode.props.onVnodeMounted
        if (vnodeHook) {
          // 解决节点钩子
          invokeVNodeHook(vnodeHook, instance.parent, vnode)
        }
      }, parentSuspense)

      if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
        // Update components tree
        // 开发工具组件添加
        devtoolsComponentAdded(instance)
      }
    }
    // 停用属性指向方法
    sharedContext.deactivate = (vnode: VNode) => {
      // 获取上下文对象
      const instance = vnode.component!
      // 移动，内容
      move(vnode, storageContainer, null, MoveType.LEAVE, parentSuspense)
      // 队列发送渲染副作用方法
      queuePostRenderEffect(() => {
        if (instance.da) {
          invokeArrayFns(instance.da)
        }
        const vnodeHook = vnode.props && vnode.props.onVnodeUnmounted
        if (vnodeHook) {
          invokeVNodeHook(vnodeHook, instance.parent, vnode)
        }
        instance.isDeactivated = true
      }, parentSuspense)

      if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
        // Update components tree
        devtoolsComponentAdded(instance)
      }
    }
    // 解除挂哉方支
    function unmount(vnode: VNode) {
      // reset the shapeFlag so it can be properly unmounted
      resetShapeFlag(vnode)
      _unmount(vnode, instance, parentSuspense, true)
    }
    // 修剪缓存
    function pruneCache(filter?: (name: string) => boolean) {
      cache.forEach((vnode, key) => {
        const name = getComponentName(vnode.type as ConcreteComponent)
        if (name && (!filter || !filter(name))) {
          pruneCacheEntry(key)
        }
      })
    }
    // 修剪缓存入口
    function pruneCacheEntry(key: CacheKey) {
      const cached = cache.get(key) as VNode
      if (!current || !isSameVNodeType(cached, current)) {
        unmount(cached)
      } else if (current) {
        // current active instance should no longer be kept-alive.
        // we can't unmount it now but it might be later, so reset its flag now.
        resetShapeFlag(current)
      }
      cache.delete(key)
      keys.delete(key)
    }

    // prune cache on include/exclude prop change
    // 监听方法属性的导入及排除导入方法
    watch(
      () => [props.include, props.exclude],
      ([include, exclude]) => {
        include && pruneCache(name => matches(include, name))
        exclude && pruneCache(name => !matches(exclude, name))
      },
      // prune post-render after `current` has been updated
      { flush: 'post', deep: true }
    )

    // cache sub tree after render
    // 缓存键指向空
    let pendingCacheKey: CacheKey | null = null
    // 缓存Subtree 指向方法
    const cacheSubtree = () => {
      // fix #1621, the pendingCacheKey could be 0
      if (pendingCacheKey != null) {
        cache.set(pendingCacheKey, getInnerChild(instance.subTree))
      }
    }

    // 挂载方法指向
    onMounted(cacheSubtree)
    // 更新方法指向
    onUpdated(cacheSubtree)
    // 解除挂载前指向
    onBeforeUnmount(() => {
      // 缓存循环
      cache.forEach(cached => {
        // 解构子树与suspense 
        const { subTree, suspense } = instance
        // 节点指向获取的子节点
        const vnode = getInnerChild(subTree)
        // 如果节点类型为节点类型，与缓存键为节点键
        if (cached.type === vnode.type && cached.key === vnode.key) {
          // current instance will be unmounted as part of keep-alive's unmount
          resetShapeFlag(vnode)
          // but invoke its deactivated hook here
          const da = vnode.component!.da
          da && queuePostRenderEffect(da, suspense)
          return
        }
        // 解除缓存挂载
        unmount(cached)
      })
    })
    // 返回函数
    return () => {
      // 缓存键指向空
      pendingCacheKey = null
      // 默认slot为假时返回空
      if (!slots.default) {
        return null
      }
      // 获取默人的slot
      const children = slots.default()
      // 获取第0个节点
      const rawVNode = children[0]
      // 如果子节点大于1个
      if (children.length > 1) {
        // 如果是开发歪境
        if (__DEV__) {
          // 
          warn(`KeepAlive should contain exactly one component child.`)
        }// 当前指向为空
        current = null
        // 返回子节点
        return children
        // 条件值为真返回原始节点
      } else if (
        !isVNode(rawVNode) ||
        (!(rawVNode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) &&
          !(rawVNode.shapeFlag & ShapeFlags.SUSPENSE))
      ) {
        current = null
        return rawVNode
      }
      // 获取子节点
      let vnode = getInnerChild(rawVNode)
      // 组件指向
      const comp = vnode.type as ConcreteComponent

      // for async components, name check should be based in its loaded
      // inner component if available
      // 获取组件名称
      const name = getComponentName(
        isAsyncWrapper(vnode)
          ? (vnode.type as ComponentOptions).__asyncResolved || {}
          : comp
      )

      const { include, exclude, max } = props
      // 如果强导入为真与排除条件为真返回原始节点
      if (
        (include && (!name || !matches(include, name))) ||
        (exclude && name && matches(exclude, name))
      ) {
        current = vnode
        return rawVNode
      }

      const key = vnode.key == null ? comp : vnode.key
      const cachedVNode = cache.get(key)

      // clone vnode if it's reused because we are going to mutate it
      // 如果节点元素为真
      if (vnode.el) {
        vnode = cloneVNode(vnode)
        if (rawVNode.shapeFlag & ShapeFlags.SUSPENSE) {
          rawVNode.ssContent = vnode
        }
      }
      // #1513 it's possible for the returned vnode to be cloned due to attr
      // fallthrough or scopeId, so the vnode here may not be the final vnode
      // that is mounted. Instead of caching it directly, we store the pending
      // key and cache `instance.subTree` (the normalized vnode) in
      // beforeMount/beforeUpdate hooks.
      pendingCacheKey = key
      // 如果缓存节点为真
      if (cachedVNode) {
        // copy over mounted state
        vnode.el = cachedVNode.el
        vnode.component = cachedVNode.component
        // 如果节点过度为真
        if (vnode.transition) {
          // recursively update transition hooks on subTree
          // 设置过度钩子
          setTransitionHooks(vnode, vnode.transition!)
        }
        // avoid vnode being mounted as fresh
        vnode.shapeFlag |= ShapeFlags.COMPONENT_KEPT_ALIVE
        // make this key the freshest
        keys.delete(key)
        keys.add(key)
      } else {
        keys.add(key)
        // prune oldest entry
        if (max && keys.size > parseInt(max as string, 10)) {
          pruneCacheEntry(keys.values().next().value)
        }
      }
      // avoid vnode being unmounted
      vnode.shapeFlag |= ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE

      current = vnode
      // 返回原始节点或者节点
      return isSuspense(rawVNode.type) ? rawVNode : vnode
    }
  }
}
// 如果组件为真
if (__COMPAT__) {
  KeepAliveImpl.__isBuildIn = true
}

// export the public type for h/tsx inference
// also to avoid inline import() in generated d.ts files
// 声名类型
export const KeepAlive = KeepAliveImpl as any as {
  __isKeepAlive: true
  new (): {
    $props: VNodeProps & KeepAliveProps
    $slots: {
      default(): VNode[]
    }
  }
}
// 搜索名称
function matches(pattern: MatchPattern, name: string): boolean {
  if (isArray(pattern)) {
    return pattern.some((p: string | RegExp) => matches(p, name))
  } else if (isString(pattern)) {
    return pattern.split(',').includes(name)
  } else if (isRegExp(pattern)) {
    return pattern.test(name)
  }
  /* istanbul ignore next */
  return false
}
// 注册缓存缓件
export function onActivated(
  hook: Function,
  target?: ComponentInternalInstance | null
) {
  registerKeepAliveHook(hook, LifecycleHooks.ACTIVATED, target)
}
// 解除注册缓存组件
export function onDeactivated(
  hook: Function,
  target?: ComponentInternalInstance | null
) {
  registerKeepAliveHook(hook, LifecycleHooks.DEACTIVATED, target)
}
// 注册缓存组件方法
function registerKeepAliveHook(
  hook: Function & { __wdc?: Function },
  type: LifecycleHooks,
  target: ComponentInternalInstance | null = currentInstance
) {
  // cache the deactivate branch check wrapper for injected hooks so the same
  // hook can be properly deduped by the scheduler. "__wdc" stands for "with
  // deactivation check".
  const wrappedHook =
    hook.__wdc ||
    (hook.__wdc = () => {
      // only fire the hook if the target instance is NOT in a deactivated branch.
      // 获取当前目标
      let current: ComponentInternalInstance | null = target
      while (current) {
        if (current.isDeactivated) {
          return
        }
        current = current.parent
      }
      // 返回钩子函九的返回值
      return hook()
    })
    // 注入钩子
  injectHook(type, wrappedHook, target)
  // In addition to registering it on the target instance, we walk up the parent
  // chain and register it on all ancestor instances that are keep-alive roots.
  // This avoids the need to walk the entire component tree when invoking these
  // hooks, and more importantly, avoids the need to track child components in
  // arrays.
  // 如果目标为真
  if (target) {
    let current = target.parent
    while (current && current.parent) {
      if (isKeepAlive(current.parent.vnode)) {
        // 注入缓存组件根
        injectToKeepAliveRoot(wrappedHook, type, target, current)
      }
      current = current.parent
    }
  }
}
// 注入静态根
function injectToKeepAliveRoot(
  hook: Function & { __weh?: Function },
  type: LifecycleHooks,
  target: ComponentInternalInstance,
  keepAliveRoot: ComponentInternalInstance
) {
  // injectHook wraps the original for error handling, so make sure to remove
  // the wrapped version.
  const injected = injectHook(type, hook, keepAliveRoot, true /* prepend */)
  onUnmounted(() => {
    remove(keepAliveRoot[type]!, injected)
  }, target)
}
// 重置形状标志
function resetShapeFlag(vnode: VNode) {
  // bitwise operations to remove keep alive flags
  vnode.shapeFlag &= ~ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE
  vnode.shapeFlag &= ~ShapeFlags.COMPONENT_KEPT_ALIVE
}
// 节取子节点
function getInnerChild(vnode: VNode) {
  return vnode.shapeFlag & ShapeFlags.SUSPENSE ? vnode.ssContent! : vnode
}
