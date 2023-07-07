import {
  NodeTransform,
  NodeTypes,
  ElementTypes,
  createCallExpression,
  resolveComponentType,
  buildProps,
  ComponentNode,
  SlotFnBuilder,
  createFunctionExpression,
  buildSlots,
  FunctionExpression,
  TemplateChildNode,
  createIfStatement,
  createSimpleExpression,
  getBaseTransformPreset,
  DOMNodeTransforms,
  DOMDirectiveTransforms,
  createReturnStatement,
  ReturnStatement,
  Namespaces,
  locStub,
  RootNode,
  TransformContext,
  CompilerOptions,
  TransformOptions,
  createRoot,
  createTransformContext,
  traverseNode,
  ExpressionNode,
  TemplateNode,
  SUSPENSE,
  TELEPORT,
  TRANSITION_GROUP,
  CREATE_VNODE,
  CallExpression,
  JSChildNode,
  RESOLVE_DYNAMIC_COMPONENT,
  TRANSITION,
  stringifyExpression
} from '@vue/compiler-dom'
import { SSR_RENDER_COMPONENT, SSR_RENDER_VNODE } from '../runtimeHelpers'
import {
  SSRTransformContext,
  processChildren,
  processChildrenAsStatement
} from '../ssrCodegenTransform'
import { ssrProcessTeleport } from './ssrTransformTeleport'
import {
  ssrProcessSuspense,
  ssrTransformSuspense
} from './ssrTransformSuspense'
import {
  ssrProcessTransitionGroup,
  ssrTransformTransitionGroup
} from './ssrTransformTransitionGroup'
import { isSymbol, isObject, isArray } from '@vue/shared'
import { buildSSRProps } from './ssrTransformElement'

// We need to construct the slot functions in the 1st pass to ensure proper
// scope tracking, but the children of each slot cannot be processed until
// the 2nd pass, so we store the WIP slot functions in a weakMap during the 1st
// pass and complete them in the 2nd pass.
const wipMap = new WeakMap<ComponentNode, WIPSlotEntry[]>()

const WIP_SLOT = Symbol()

interface WIPSlotEntry {
  type: typeof WIP_SLOT
  fn: FunctionExpression
  children: TemplateChildNode[]
  vnodeBranch: ReturnStatement
}

const componentTypeMap = new WeakMap<
  ComponentNode,
  string | symbol | CallExpression
>()

// ssr component transform is done in two phases:
// In phase 1. we use `buildSlot` to analyze the children of the component into
// WIP slot functions (it must be done in phase 1 because `buildSlot` relies on
// the core transform context).
// In phase 2. we convert the WIP slots from phase 1 into ssr-specific codegen
// nodes.
// SSR转换组件
export const ssrTransformComponent: NodeTransform = (node, context) => {
  if (
    node.type !== NodeTypes.ELEMENT ||
    node.tagType !== ElementTypes.COMPONENT
  ) {
    return
  }
  // 转换组件类型
  const component = resolveComponentType(node, context, true /* ssr */)
  const isDynamicComponent =
    isObject(component) && component.callee === RESOLVE_DYNAMIC_COMPONENT
  componentTypeMap.set(node, component)
  // 是单独的地址
  if (isSymbol(component)) {
    if (component === SUSPENSE) {
      // SSR转换SUPENSE
      return ssrTransformSuspense(node, context)
    }
    if (component === TRANSITION_GROUP) {
      // SS转换组
      return ssrTransformTransitionGroup(node, context)
    }
    return // other built-in components: fallthrough
  }

  // Build the fallback vnode-based branch for the component's slots.
  // We need to clone the node into a fresh copy and use the buildSlots' logic
  // to get access to the children of each slot. We then compile them with
  // a child transform pipeline using vnode-based transforms (instead of ssr-
  // based ones), and save the result branch (a ReturnStatement) in an array.
  // The branch is retrieved when processing slots again in ssr mode.
  const vnodeBranches: ReturnStatement[] = []
  // 克隆节点
  const clonedNode = clone(node)
  // SSR属性转换组件
  return function ssrPostTransformComponent() {
    // Using the cloned node, build the normal VNode-based branches (for
    // fallback in case the child is render-fn based). Store them in an array
    // for later use.
    if (clonedNode.children.length) {
      // 构建SLOT
      buildSlots(clonedNode, context, (props, children) => {
        // 创建SLOT分支并压入节点分支
        vnodeBranches.push(createVNodeSlotBranch(props, children, context))
        // 创建函数表达式
        return createFunctionExpression(undefined)
      })
    }

    let propsExp: string | JSChildNode = `null`
    if (node.props.length) {
      // note we are not passing ssr: true here because for components, v-on
      // handlers should still be passed
      // 构建属性  解构属性与指令
      const { props, directives } = buildProps(
        node,
        context,
        undefined,
        true,
        isDynamicComponent
      )
      if (props || directives.length) {
        // 构建SSR属性
        propsExp = buildSSRProps(props, directives, context)
      }
    }

    const wipEntries: WIPSlotEntry[] = []
    wipMap.set(node, wipEntries)
    // 构建SSRSLOTFn
    const buildSSRSlotFn: SlotFnBuilder = (props, children, loc) => {
      const param0 = (props && stringifyExpression(props)) || `_`
      // 创建函数表达式
      const fn = createFunctionExpression(
        [param0, `_push`, `_parent`, `_scopeId`],
        undefined, // no return, assign body later
        true, // newline
        true, // isSlot
        loc
      )
      // 压入对象
      wipEntries.push({
        type: WIP_SLOT,
        fn,
        children,
        // also collect the corresponding vnode branch built earlier
        vnodeBranch: vnodeBranches[wipEntries.length]
      })
      return fn
    }

    const slots = node.children.length
      ? buildSlots(node, context, buildSSRSlotFn).slots
      : `null`

    if (typeof component !== 'string') {
      // dynamic component that resolved to a `resolveDynamicComponent` call
      // expression - since the resolved result may be a plain element (string)
      // or a VNode, handle it with `renderVNode`.
      // 创建表达式
      node.ssrCodegenNode = createCallExpression(
        context.helper(SSR_RENDER_VNODE),
        [
          `_push`,
          createCallExpression(context.helper(CREATE_VNODE), [
            component,
            propsExp,
            slots
          ]),
          `_parent`
        ]
      )
    } else {
      // 创建表达式
      node.ssrCodegenNode = createCallExpression(
        context.helper(SSR_RENDER_COMPONENT),
        [component, propsExp, slots, `_parent`]
      )
    }
  }
}
// ssr 进程组件
export function ssrProcessComponent(
  node: ComponentNode,
  context: SSRTransformContext,
  parent: { children: TemplateChildNode[] }
) {
  // 获取节点
  const component = componentTypeMap.get(node)!
  // 如果节点ssr编译节点为假
  if (!node.ssrCodegenNode) {
    // this is a built-in component that fell-through.
    // 如果组件为为TELEPORT
    if (component === TELEPORT) {
      return ssrProcessTeleport(node, context)
    } else if (component === SUSPENSE) {
      // 返回SSRSUSPENSE转换后的内容
      return ssrProcessSuspense(node, context)
    } else if (component === TRANSITION_GROUP) {
      // 返回SSR转换组
      return ssrProcessTransitionGroup(node, context)
    } else {
      // real fall-through: Transition / KeepAlive
      // just render its children.
      // #5352: if is at root level of a slot, push an empty string.
      // this does not affect the final output, but avoids all-comment slot
      // content of being treated as empty by ssrRenderSlot().
      if ((parent as WIPSlotEntry).type === WIP_SLOT) {
        // 压入字符串
        context.pushStringPart(``)
      }
      // #5351: filter out comment children inside transition
      if (component === TRANSITION) {
        // 过虑指定节点
        node.children = node.children.filter(c => c.type !== NodeTypes.COMMENT)
      }
      // 编码节点并连接到上下文对象
      processChildren(node, context)
    }
  } else {
    // finish up slot function expressions from the 1st pass.
    // 获取节点对应的值
    const wipEntries = wipMap.get(node) || []
    for (let i = 0; i < wipEntries.length; i++) {
      // 解构fn 节点分支
      const { fn, vnodeBranch } = wipEntries[i]
      // For each slot, we generate two branches: one SSR-optimized branch and
      // one normal vnode-based branch. The branches are taken based on the
      // presence of the 2nd `_push` argument (which is only present if the slot
      // is called by `_ssrRenderSlot`.
      // 创建IF语句
      fn.body = createIfStatement(
        // 创建简单表达式
        createSimpleExpression(`_push`, false),
        // 语句
        processChildrenAsStatement(
          wipEntries[i],
          context,
          false,
          true /* withSlotScopeId */
        ),
        vnodeBranch
      )
    }

    // component is inside a slot, inherit slot scope Id
    if (context.withSlotScopeId) {
      // 在参数中压入作用域ID
      node.ssrCodegenNode.arguments.push(`_scopeId`)
    }

    if (typeof component === 'string') {
      // static component
      // 压入语句
      context.pushStatement(
        // 创建表达式对象
        createCallExpression(`_push`, [node.ssrCodegenNode])
      )
    } else {
      // dynamic component (`resolveDynamicComponent` call)
      // the codegen node is a `renderVNode` call
      // 将SSR语句压入上下文对象
      context.pushStatement(node.ssrCodegenNode)
    }
  }
}

export const rawOptionsMap = new WeakMap<RootNode, CompilerOptions>()
// 获取基本转换Preset 并解构
const [baseNodeTransforms, baseDirectiveTransforms] =
  getBaseTransformPreset(true)
const vnodeNodeTransforms = [...baseNodeTransforms, ...DOMNodeTransforms]
const vnodeDirectiveTransforms = {
  ...baseDirectiveTransforms,
  ...DOMDirectiveTransforms
}
// 创建节点slot分支
function createVNodeSlotBranch(
  props: ExpressionNode | undefined,
  children: TemplateChildNode[],
  parentContext: TransformContext
): ReturnStatement {
  // apply a sub-transform using vnode-based transforms.
  const rawOptions = rawOptionsMap.get(parentContext.root)!

  const subOptions = {
    ...rawOptions,
    // overwrite with vnode-based transforms
    nodeTransforms: [
      ...vnodeNodeTransforms,
      ...(rawOptions.nodeTransforms || [])
    ],
    directiveTransforms: {
      ...vnodeDirectiveTransforms,
      ...(rawOptions.directiveTransforms || {})
    }
  }

  // wrap the children with a wrapper template for proper children treatment.
  const wrapperNode: TemplateNode = {
    type: NodeTypes.ELEMENT,
    ns: Namespaces.HTML,
    tag: 'template',
    tagType: ElementTypes.TEMPLATE,
    isSelfClosing: false,
    // important: provide v-slot="props" on the wrapper for proper
    // scope analysis
    props: [
      {
        type: NodeTypes.DIRECTIVE,
        name: 'slot',
        exp: props,
        arg: undefined,
        modifiers: [],
        loc: locStub
      }
    ],
    children,
    loc: locStub,
    codegenNode: undefined
  }
  subTransform(wrapperNode, subOptions, parentContext)
  // 创建返回的语句
  return createReturnStatement(children)
}
// 子变换 将指定内容设置
function subTransform(
  node: TemplateChildNode,
  options: TransformOptions,
  parentContext: TransformContext
) {
  // 获取子根节点
  const childRoot = createRoot([node]);
  // 创建转换上下文对象
  const childContext = createTransformContext(childRoot, options)
  // this sub transform is for vnode fallback branch so it should be handled
  // like normal render functions
  // ssr 设置为 false
  childContext.ssr = false
  // inherit parent scope analysis state
  // scopes 获取
  childContext.scopes = { ...parentContext.scopes }
  childContext.identifiers = { ...parentContext.identifiers }
  childContext.imports = parentContext.imports
  // traverse
  // 获取当前上下文对象的子节点
  traverseNode(childRoot, childContext)
  // merge helpers/components/directives into parent context
  // 循环 helpers components 
  ;(['helpers', 'components', 'directives'] as const).forEach(key => {
    // 循环子上下文对象key 中的内容
    childContext[key].forEach((value: any, helperKey: any) => {
      if (key === 'helpers') {
        const parentCount = parentContext.helpers.get(helperKey)
        if (parentCount === undefined) {
          parentContext.helpers.set(helperKey, value)
        } else {
          parentContext.helpers.set(helperKey, value + parentCount)
        }
      } else {
        ;(parentContext[key] as any).add(value)
      }
    })
  })
  // imports/hoists are not merged because:
  // - imports are only used for asset urls and should be consistent between
  //   node/client branches
  // - hoists are not enabled for the client branch here
}
// 考贝方法
function clone(v: any): any {
  if (isArray(v)) {
    return v.map(clone)
  } else if (isObject(v)) {
    const res: any = {}
    for (const key in v) {
      res[key] = clone(v[key])
    }
    return res
  } else {
    return v
  }
}
