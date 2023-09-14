import {
  VNode,
  normalizeVNode,
  Text,
  Comment,
  Static,
  Fragment,
  VNodeHook,
  createVNode,
  createTextVNode,
  invokeVNodeHook
} from './vnode'
import { flushPostFlushCbs } from './scheduler'
import { ComponentInternalInstance } from './component'
import { invokeDirectiveHook } from './directives'
import { warn } from './warning'
import { PatchFlags, ShapeFlags, isReservedProp, isOn } from '@vue/shared'
import { RendererInternals } from './renderer'
import { setRef } from './rendererTemplateRef'
import {
  SuspenseImpl,
  SuspenseBoundary,
  queueEffectWithSuspense
} from './components/Suspense'
import { TeleportImpl, TeleportVNode } from './components/Teleport'
import { isAsyncWrapper } from './apiAsyncComponent'

export type RootHydrateFunction = (
  vnode: VNode<Node, Element>,
  container: (Element | ShadowRoot) & { _vnode?: VNode }
) => void

const enum DOMNodeTypes {
  ELEMENT = 1,
  TEXT = 3,
  COMMENT = 8
}

let hasMismatch = false
// 判断是SVG内容
const isSVGContainer = (container: Element) =>
  /svg/.test(container.namespaceURI!) && container.tagName !== 'foreignObject'
// 判断是注释节点
const isComment = (node: Node): node is Comment =>
  node.nodeType === DOMNodeTypes.COMMENT

// Note: hydration is DOM-specific
// But we have to place it in core due to tight coupling with core - splitting
// it out creates a ton of unnecessary complexity.
// Hydration also depends on some renderer internal logic which needs to be
// passed in via arguments.
// 创建激活方法
export function createHydrationFunctions(
  rendererInternals: RendererInternals<Node, Element>
) {
  const {
    mt: mountComponent,
    p: patch,
    o: {
      patchProp,
      createText,
      nextSibling,
      parentNode,
      remove,
      insert,
      createComment
    }
  } = rendererInternals
  // 激活方法定义
  const hydrate: RootHydrateFunction = (vnode, container) => {
    // 如果没有子节点
    if (!container.hasChildNodes()) {
      __DEV__ &&
        warn(
          `Attempting to hydrate existing markup but container is empty. ` +
            `Performing full mount instead.`
        )
        // 更新
      patch(null, vnode, container)
      // 执行调度器
      flushPostFlushCbs()
      container._vnode = vnode
      return
    }
    hasMismatch = false
    // 激活节点
    hydrateNode(container.firstChild!, vnode, null, null, null)
    // 执行调度器
    flushPostFlushCbs()
    container._vnode = vnode
    if (hasMismatch && !__TEST__) {
      // this error should show up in production
      console.error(`Hydration completed but contains mismatches.`)
    }
  }
  // 激活节点方法
  const hydrateNode = (
    node: Node,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized = false
  ): Node | null => {
    // 判断是评论
    const isFragmentStart = isComment(node) && node.data === '['
    // 不匹配时
    const onMismatch = () =>
      handleMismatch(
        node,
        vnode,
        parentComponent,
        parentSuspense,
        slotScopeIds,
        isFragmentStart
      )
        // 解构节点类型ref更新标志
    const { type, ref, shapeFlag, patchFlag } = vnode
    // 获取节点类型
    let domType = node.nodeType
    // 节点元素指向
    vnode.el = node
        // 
    if (patchFlag === PatchFlags.BAIL) {
      optimized = false
      vnode.dynamicChildren = null
    }
    // 下一个节点指向空
    let nextNode: Node | null = null
    // 开关
    switch (type) {
      // 如果类型是文本
      case Text:
        if (domType !== DOMNodeTypes.TEXT) {
          // #5728 empty text node inside a slot can cause hydration failure
          // because the server rendered HTML won't contain a text node
          // 节点子元素是空时
          if (vnode.children === '') {
            insert((vnode.el = createText('')), parentNode(node)!, node)
            nextNode = node
          } else {
            nextNode = onMismatch()
          }
        } else {
          if ((node as Text).data !== vnode.children) {
            hasMismatch = true
            // 是开发环境抛出警告
            __DEV__ &&
              warn(
                `Hydration text mismatch:` +
                  `\n- Client: ${JSON.stringify((node as Text).data)}` +
                  `\n- Server: ${JSON.stringify(vnode.children)}`
              )
            ;(node as Text).data = vnode.children as string
          }
          nextNode = nextSibling(node)
        }
        break
        // 注释
      case Comment:
        // 如果节点类型不是注释或者是片段开始
        if (domType !== DOMNodeTypes.COMMENT || isFragmentStart) {
          nextNode = onMismatch()
        } else {
          nextNode = nextSibling(node)
        }
        break
        // 静态
      case Static:
        // 如果是片段开始
        if (isFragmentStart) {
          // entire template is static but SSRed as a fragment
          node = nextSibling(node)!
          domType = node.nodeType
        }
        // 如果节点类型是元素或者节点类型为文本
        if (domType === DOMNodeTypes.ELEMENT || domType === DOMNodeTypes.TEXT) {
          // determine anchor, adopt content
          nextNode = node
          // if the static vnode has its content stripped during build,
          // adopt it from the server-rendered HTML.
          const needToAdoptContent = !(vnode.children as string).length
          for (let i = 0; i < vnode.staticCount!; i++) {
            if (needToAdoptContent)
              vnode.children +=
                nextNode.nodeType === DOMNodeTypes.ELEMENT
                  ? (nextNode as Element).outerHTML
                  : (nextNode as Text).data
            if (i === vnode.staticCount! - 1) {
              vnode.anchor = nextNode
            }
            // 指向下一个同级节点
            nextNode = nextSibling(nextNode)!
          }
          // 返回
          return isFragmentStart ? nextSibling(nextNode) : nextNode
        } else {
          // 执行搜索
          onMismatch()
        }
        break
        // 代码片段 
      case Fragment:
        // 如果不是代码片段
        if (!isFragmentStart) {
          nextNode = onMismatch()
        } else {
          // 激活代码片段
          nextNode = hydrateFragment(
            node as Comment,
            vnode,
            parentComponent,
            parentSuspense,
            slotScopeIds,
            optimized
          )
        }
        break
        // 默认
      default:
        if (shapeFlag & ShapeFlags.ELEMENT) {
          if (
            domType !== DOMNodeTypes.ELEMENT ||
            (vnode.type as string).toLowerCase() !==
              (node as Element).tagName.toLowerCase()
          ) {
            // 指向搜索返回值
            nextNode = onMismatch()
          } else {
            // 激活元素
            nextNode = hydrateElement(
              node as Element,
              vnode,
              parentComponent,
              parentSuspense,
              slotScopeIds,
              optimized
            )
          }
        } else if (shapeFlag & ShapeFlags.COMPONENT) {
          // when setting up the render effect, if the initial vnode already
          // has .el set, the component will perform hydration instead of mount
          // on its sub-tree.
          vnode.slotScopeIds = slotScopeIds
          // 指向上级节点
          const container = parentNode(node)!
          // 挂载组件
          mountComponent(
            vnode,
            container,
            null,
            parentComponent,
            parentSuspense,
            isSVGContainer(container),
            optimized
          )

          // component may be async, so in the case of fragments we cannot rely
          // on component's rendered output to determine the end of the fragment
          // instead, we do a lookahead to find the end anchor node.
          // 指向下一个节点
          nextNode = isFragmentStart
            ? locateClosingAsyncAnchor(node)
            : nextSibling(node)

          // #4293 teleport as component root
          if (
            nextNode &&
            isComment(nextNode) &&
            nextNode.data === 'teleport end'
          ) {
            nextNode = nextSibling(nextNode)
          }

          // #3787
          // if component is async, it may get moved / unmounted before its
          // inner component is loaded, so we need to give it a placeholder
          // vnode that matches its adopted DOM.
          // 如果节点是异步的外包装
          if (isAsyncWrapper(vnode)) {
            let subTree
            if (isFragmentStart) {
              // 子树指向创建的节点
              subTree = createVNode(Fragment)
              subTree.anchor = nextNode
                ? nextNode.previousSibling
                : container.lastChild
            } else {
              subTree =
                node.nodeType === 3 ? createTextVNode('') : createVNode('div')
            }
            subTree.el = node
            vnode.component!.subTree = subTree
          }
        } else if (shapeFlag & ShapeFlags.TELEPORT) {
          if (domType !== DOMNodeTypes.COMMENT) {
            nextNode = onMismatch()
          } else {
            nextNode = (vnode.type as typeof TeleportImpl).hydrate(
              node,
              vnode as TeleportVNode,
              parentComponent,
              parentSuspense,
              slotScopeIds,
              optimized,
              rendererInternals,
              hydrateChildren
            )
          }
        } else if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
          nextNode = (vnode.type as typeof SuspenseImpl).hydrate(
            node,
            vnode,
            parentComponent,
            parentSuspense,
            isSVGContainer(parentNode(node)!),
            slotScopeIds,
            optimized,
            rendererInternals,
            hydrateNode
          )
        } else if (__DEV__) {
          warn('Invalid HostVNode type:', type, `(${typeof type})`)
        }
    }

    if (ref != null) {
      // 设置REF
      setRef(ref, null, parentSuspense, vnode)
    }

    return nextNode
  }
  // 激活元素方法
  const hydrateElement = (
    el: Element,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    optimized = optimized || !!vnode.dynamicChildren
    const { type, props, patchFlag, shapeFlag, dirs } = vnode
    // #4006 for form elements with non-string v-model value bindings
    // e.g. <option :value="obj">, <input type="checkbox" :true-value="1">
    const forcePatchValue = (type === 'input' && dirs) || type === 'option'
    // skip props & children if this is hoisted static nodes
    // #5405 in dev, always hydrate children for HMR
    if (__DEV__ || forcePatchValue || patchFlag !== PatchFlags.HOISTED) {
      if (dirs) {
        // 如果指令为真调用指令勾子
        invokeDirectiveHook(vnode, null, parentComponent, 'created')
      }
      // props
      if (props) {
        if (
          forcePatchValue ||
          !optimized ||
          patchFlag & (PatchFlags.FULL_PROPS | PatchFlags.HYDRATE_EVENTS)
        ) {
          for (const key in props) {
            if (
              (forcePatchValue && key.endsWith('value')) ||
              (isOn(key) && !isReservedProp(key))
            ) {
              // 更新属性
              patchProp(
                el,
                key,
                null,
                props[key],
                false,
                undefined,
                parentComponent
              )
            }
          }
        } else if (props.onClick) {
          // Fast path for click listeners (which is most often) to avoid
          // iterating through props.
          // 更新属性
          patchProp(
            el,
            'onClick',
            null,
            props.onClick,
            false,
            undefined,
            parentComponent
          )
        }
      }
      // vnode / directive hooks
      let vnodeHooks: VNodeHook | null | undefined
      if ((vnodeHooks = props && props.onVnodeBeforeMount)) {
        // 调用节点勾子
        invokeVNodeHook(vnodeHooks, parentComponent, vnode)
      }
      if (dirs) {
        invokeDirectiveHook(vnode, null, parentComponent, 'beforeMount')
      }
      if ((vnodeHooks = props && props.onVnodeMounted) || dirs) {
        // 队列副作用悬挂
        queueEffectWithSuspense(() => {
          vnodeHooks && invokeVNodeHook(vnodeHooks, parentComponent, vnode)
          dirs && invokeDirectiveHook(vnode, null, parentComponent, 'mounted')
        }, parentSuspense)
      }
      // children
      if (
        shapeFlag & ShapeFlags.ARRAY_CHILDREN &&
        // skip if element has innerHTML / textContent
        !(props && (props.innerHTML || props.textContent))
      ) {
        // 激活子节点
        let next = hydrateChildren(
          el.firstChild,
          vnode,
          el,
          parentComponent,
          parentSuspense,
          slotScopeIds,
          optimized
        )
        let hasWarned = false
        while (next) {
          hasMismatch = true
          if (__DEV__ && !hasWarned) {
            warn(
              `Hydration children mismatch in <${vnode.type as string}>: ` +
                `server rent vdom.`
            )
            hasWarned = true
          }
          // The SSRed DOM contains more nodes than it should. Remove them.
          const cur = next
          next = next.nextSibling
          // 移除
          remove(cur)
        }
      } else if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
        if (el.textContent !== vnode.children) {
          hasMismatch = true
          __DEV__ &&
            warn(
              `Hydration text content mismatch in <${
                vnode.type as string
              }>:\n` +
                `- Client: ${el.textContent}\n` +
                `- Server: ${vnode.children as string}`
            )
          el.textContent = vnode.children as string
        }
      }
    }
    return el.nextSibling
  }
  // 激活子节点
  const hydrateChildren = (
    node: Node | null,
    parentVNode: VNode,
    container: Element,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean
  ): Node | null => {
    optimized = optimized || !!parentVNode.dynamicChildren
    const children = parentVNode.children as VNode[]
    const l = children.length
    let hasWarned = false
    for (let i = 0; i < l; i++) {
      // 规范化节点
      const vnode = optimized
        ? children[i]
        : (children[i] = normalizeVNode(children[i]))
      if (node) {
        // 激活节点
        node = hydrateNode(
          node,
          vnode,
          parentComponent,
          parentSuspense,
          slotScopeIds,
          optimized
        )
      } else if (vnode.type === Text && !vnode.children) {
        continue
      } else {
        hasMismatch = true
        if (__DEV__ && !hasWarned) {
          warn(
            `Hydration children mismatch in <${container.tagName.toLowerCase()}>: ` +
              `server rendered element contains fewer child nodes than client vdom.`
          )
          hasWarned = true
        }
        // the SSRed DOM didn't contain enough nodes. Mount the missing ones.
        // 更新
        patch(
          null,
          vnode,
          container,
          null,
          parentComponent,
          parentSuspense,
          isSVGContainer(container),
          slotScopeIds
        )
      }
    }
    return node
  }
  // 激活片段
  const hydrateFragment = (
    node: Comment,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    const { slotScopeIds: fragmentSlotScopeIds } = vnode
    if (fragmentSlotScopeIds) {
      slotScopeIds = slotScopeIds
        ? slotScopeIds.concat(fragmentSlotScopeIds)
        : fragmentSlotScopeIds
    }
    // 上级节点获取
    const container = parentNode(node)!
    // 激活子节点
    const next = hydrateChildren(
      nextSibling(node)!,
      vnode,
      container,
      parentComponent,
      parentSuspense,
      slotScopeIds,
      optimized
    )
    if (next && isComment(next) && next.data === ']') {
      // 返回下一个同级节点
      return nextSibling((vnode.anchor = next))
    } else {
      // fragment didn't hydrate successfully, since we didn't get a end anchor
      // back. This should have led to node/children mismatch warnings.
      hasMismatch = true
      // since the anchor is missing, we need to create one and insert it
      // 插入内容
      insert((vnode.anchor = createComment(`]`)), container, next)
      return next
    }
  }
  // 处理不匹配
  const handleMismatch = (
    node: Node,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    isFragment: boolean
  ): Node | null => {
    hasMismatch = true
    __DEV__ &&
      warn(
        `Hydration node mismatch:\n- Client vnode:`,
        vnode.type,
        `\n- Server rendered DOM:`,
        node,
        node.nodeType === DOMNodeTypes.TEXT
          ? `(text)`
          : isComment(node) && node.data === '['
          ? `(start of fragment)`
          : ``
      )
    vnode.el = null

    if (isFragment) {
      // remove excessive fragment nodes
      // 定位关闭异步锚
      const end = locateClosingAsyncAnchor(node)
      while (true) {
        const next = nextSibling(node)
        if (next && next !== end) {
          remove(next)
        } else {
          break
        }
      }
    }

    const next = nextSibling(node)
    const container = parentNode(node)!
    remove(node)

    patch(
      null,
      vnode,
      container,
      next,
      parentComponent,
      parentSuspense,
      isSVGContainer(container),
      slotScopeIds
    )
    return next
  }

  const locateClosingAsyncAnchor = (node: Node | null): Node | null => {
    let match = 0
    while (node) {
      node = nextSibling(node)
      if (node && isComment(node)) {
        if (node.data === '[') match++
        if (node.data === ']') {
          if (match === 0) {
            return nextSibling(node)
          } else {
            match--
          }
        }
      }
    }
    return node
  }
  // 返回激活与激活节点
  return [hydrate, hydrateNode] as const
}
