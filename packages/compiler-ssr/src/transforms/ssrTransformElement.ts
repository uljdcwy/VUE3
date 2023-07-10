import {
  NodeTransform,
  NodeTypes,
  ElementTypes,
  TemplateLiteral,
  createTemplateLiteral,
  createInterpolation,
  createCallExpression,
  createConditionalExpression,
  createSimpleExpression,
  buildProps,
  DirectiveNode,
  PlainElementNode,
  createCompilerError,
  ErrorCodes,
  CallExpression,
  createArrayExpression,
  ExpressionNode,
  JSChildNode,
  ArrayExpression,
  createAssignmentExpression,
  TextNode,
  hasDynamicKeyVBind,
  MERGE_PROPS,
  isStaticArgOf,
  createSequenceExpression,
  InterpolationNode,
  isStaticExp,
  AttributeNode,
  buildDirectiveArgs,
  TransformContext,
  PropsExpression
} from '@vue/compiler-dom'
import {
  escapeHtml,
  isBooleanAttr,
  isBuiltInDirective,
  isSSRSafeAttrName,
  NO,
  propsToAttrMap
} from '@vue/shared'
import { createSSRCompilerError, SSRErrorCodes } from '../errors'
import {
  SSR_RENDER_ATTR,
  SSR_RENDER_CLASS,
  SSR_RENDER_STYLE,
  SSR_RENDER_DYNAMIC_ATTR,
  SSR_RENDER_ATTRS,
  SSR_INTERPOLATE,
  SSR_GET_DYNAMIC_MODEL_PROPS,
  SSR_INCLUDE_BOOLEAN_ATTR,
  SSR_GET_DIRECTIVE_PROPS
} from '../runtimeHelpers'
import { SSRTransformContext, processChildren } from '../ssrCodegenTransform'

// for directives with children overwrite (e.g. v-html & v-text), we need to
// store the raw children so that they can be added in the 2nd pass.
const rawChildrenMap = new WeakMap<
  PlainElementNode,
  TemplateLiteral['elements'][0]
>()
// SSR 转换元素
export const ssrTransformElement: NodeTransform = (node, context) => {
  if (
    node.type !== NodeTypes.ELEMENT ||
    node.tagType !== ElementTypes.ELEMENT
  ) {
    return
  }
  // SSR POST转换元素
  return function ssrPostTransformElement() {
    // element
    // generate the template literal representing the open tag.
    const openTag: TemplateLiteral['elements'] = [`<${node.tag}`]
    // some tags need to be passed to runtime for special checks
    const needTagForRuntime =
      node.tag === 'textarea' || node.tag.indexOf('-') > 0

    // v-bind="obj", v-bind:[key] and custom directives can potentially
    // overwrite other static attrs and can affect final rendering result,
    // so when they are present we need to bail out to full `renderAttrs`
    // 有活动的KEY绑定
    const hasDynamicVBind = hasDynamicKeyVBind(node)
    // 有自定义指令
    const hasCustomDir = node.props.some(
      p => p.type === NodeTypes.DIRECTIVE && !isBuiltInDirective(p.name)
    )
    // 需要合并属性
    const needMergeProps = hasDynamicVBind || hasCustomDir
    // 如是有需要合并属性
    if (needMergeProps) {
      // 解构属性与指令
      const { props, directives } = buildProps(
        node,
        context,
        node.props,
        false /* isComponent */,
        false /* isDynamicComponent */,
        true /* ssr */
      )
      // 如果属性为真或者指令长度为真
      if (props || directives.length) {
        // 构建SSR属性
        const mergedProps = buildSSRProps(props, directives, context)
        // 创建可执行表达式
        const propsExp = createCallExpression(
          context.helper(SSR_RENDER_ATTRS),
          [mergedProps]
        )
          // 如果节点标签为textarea
        if (node.tag === 'textarea') {
          // 获取指一个子元素
          const existingText = node.children[0] as
            | TextNode
            | InterpolationNode
            | undefined
          // If interpolation, this is dynamic <textarea> content, potentially
          // injected by v-model and takes higher priority than v-bind value
          // 如果第一个子元素为假或者类型不为可插入元素
          if (!existingText || existingText.type !== NodeTypes.INTERPOLATION) {
            // <textarea> with dynamic v-bind. We don't know if the final props
            // will contain .value, so we will have to do something special:
            // assign the merged props to a temp variable, and check whether
            // it contains value (if yes, render is as children).
            // 获取tempID
            const tempId = `_temp${context.temps++}`
            // 属性表达式参数为返回的表达式
            propsExp.arguments = [
              createAssignmentExpression(
                createSimpleExpression(tempId, false),
                mergedProps
              )
            ]
            // 在图中设置节点指向创建的表达式
            rawChildrenMap.set(
              node,
              createCallExpression(context.helper(SSR_INTERPOLATE), [
                createConditionalExpression(
                  createSimpleExpression(`"value" in ${tempId}`, false),
                  createSimpleExpression(`${tempId}.value`, false),
                  createSimpleExpression(
                    existingText ? existingText.content : ``,
                    true
                  ),
                  false
                )
              ])
            )
          }
          // 如果节点标签为inpput
        } else if (node.tag === 'input') {
          // <input v-bind="obj" v-model>
          // we need to determine the props to render for the dynamic v-model
          // and merge it with the v-bind expression.
          // 在节点中找Model属性
          const vModel = findVModel(node)
          // 如果有
          if (vModel) {
            // 1. save the props (san v-model) in a temp variable
            // tempID自增
            const tempId = `_temp${context.temps++}`
            // 创建简单表达式
            const tempExp = createSimpleExpression(tempId, false)
            // 设置属性表达式参数
            propsExp.arguments = [
              createSequenceExpression([
                createAssignmentExpression(tempExp, mergedProps),
                createCallExpression(context.helper(MERGE_PROPS), [
                  tempExp,
                  createCallExpression(
                    context.helper(SSR_GET_DYNAMIC_MODEL_PROPS),
                    [
                      tempExp, // existing props
                      vModel.exp! // model
                    ]
                  )
                ])
              ])
            ]
          }
        }
        // 如果需要标签For运行 在属性表达式参数中压入 节点标签
        if (needTagForRuntime) {
          propsExp.arguments.push(`"${node.tag}"`)
        }
        // 在打开的标签中压入属性表达式
        openTag.push(propsExp)
      }
    }

    // book keeping static/dynamic class merging.
    // 有绑定类
    let dynamicClassBinding: CallExpression | undefined = undefined
    // 静态的类绑定
    let staticClassBinding: string | undefined = undefined
    // all style bindings are converted to dynamic by transformStyle.
    // but we need to make sure to merge them.
    // 有绑定样式
    let dynamicStyleBinding: CallExpression | undefined = undefined
    // 循节点属性
    for (let i = 0; i < node.props.length; i++) {
      // 获取当前属性
      const prop = node.props[i]
      // ignore true-value/false-value on input
      // 如果节点标签为input 与 是真假值
      if (node.tag === 'input' && isTrueFalseValue(prop)) {
        continue
      }
      // special cases with children override
      // 如果属性类型为指令
      if (prop.type === NodeTypes.DIRECTIVE) {
        // 如要属性名称为html与属性表达式为真
        if (prop.name === 'html' && prop.exp) {
          // 设节点并指向表达式
          rawChildrenMap.set(node, prop.exp)
          // 如果属性名称为text 与属性表达式为真
        } else if (prop.name === 'text' && prop.exp) {
          // 获取编译后的文本
          node.children = [createInterpolation(prop.exp, prop.loc)]
          // 如果属笥名称为slot
        } else if (prop.name === 'slot') {
          // 抛出错误
          context.onError(
            createCompilerError(ErrorCodes.X_V_SLOT_MISPLACED, prop.loc)
          )
          // 如果是文本域值与属性表达式为真
        } else if (isTextareaWithValue(node, prop) && prop.exp) {
          // 如果不需要合并属笥获取文本值
          if (!needMergeProps) {
            node.children = [createInterpolation(prop.exp, prop.loc)]
          }
          // 如果需要合并为假与属性名称不为on
        } else if (!needMergeProps && prop.name !== 'on') {
          // Directive transforms.
          // 指令转换手续费向指令转换的属性名称
          const directiveTransform = context.directiveTransforms[prop.name]
          // 如果指令转换为真
          if (directiveTransform) {
            // 解构指令中的属怀与SSR标签
            const { props, ssrTagParts } = directiveTransform(
              prop,
              node,
              context
            )
            // 如果SSR标签部签为真
            if (ssrTagParts) {
              // 打开标签压入SSR标签部分
              openTag.push(...ssrTagParts)
            }
            // 循环属性长度
            for (let j = 0; j < props.length; j++) {
              // 解构KEY与值
              const { key, value } = props[j]
              // 如果是静态表达式
              if (isStaticExp(key)) {
                // 属性名称指向key内容
                let attrName = key.content
                // static key attr
                // 如果属性名称为key与属性名称为ref跳过
                if (attrName === 'key' || attrName === 'ref') {
                  continue
                }
                // 如果属性名称为class
                if (attrName === 'class') {
                  // 打开标签压入class 
                  openTag.push(
                    ` class="`,
                    (dynamicClassBinding = createCallExpression(
                      context.helper(SSR_RENDER_CLASS),
                      [value]
                    )),
                    `"`
                  )
                  // 如果属性名称为style
                } else if (attrName === 'style') {
                  //  如果有绑定样式
                  if (dynamicStyleBinding) {
                    // already has style binding, merge into it.
                    // 合并属性
                    mergeCall(dynamicStyleBinding, value)
                  } else {
                    // 标签中压入样式
                    openTag.push(
                      ` style="`,
                      (dynamicStyleBinding = createCallExpression(
                        context.helper(SSR_RENDER_STYLE),
                        [value]
                      )),
                      `"`
                    )
                  }
                } else {
                  // 获取属性名称
                  attrName =
                    node.tag.indexOf('-') > 0
                      ? attrName // preserve raw name on custom elements
                      : propsToAttrMap[attrName] || attrName.toLowerCase()
                      // 如果属性名称是布尔属性
                  if (isBooleanAttr(attrName)) {
                    // 标签中压入
                    openTag.push(
                      createConditionalExpression(
                        createCallExpression(
                          context.helper(SSR_INCLUDE_BOOLEAN_ATTR),
                          [value]
                        ),
                        createSimpleExpression(' ' + attrName, true),
                        createSimpleExpression('', true),
                        false /* no newline */
                      )
                    )
                    // 如果是SSR属笥
                  } else if (isSSRSafeAttrName(attrName)) {
                    // 标签中压入属笥
                    openTag.push(
                      createCallExpression(context.helper(SSR_RENDER_ATTR), [
                        key,
                        value
                      ])
                    )
                  } else {
                    // 抛出错误
                    context.onError(
                      createSSRCompilerError(
                        SSRErrorCodes.X_SSR_UNSAFE_ATTR_NAME,
                        key.loc
                      )
                    )
                  }
                }
              } else {
                // dynamic key attr
                // this branch is only encountered for custom directive
                // transforms that returns properties with dynamic keys
                // 获取参数
                const args: CallExpression['arguments'] = [key, value]
                // 如果需要标签运行
                if (needTagForRuntime) {
                  // 参数压入标签
                  args.push(`"${node.tag}"`)
                }
                openTag.push(
                  createCallExpression(
                    context.helper(SSR_RENDER_DYNAMIC_ATTR),
                    args
                  )
                )
              }
            }
          }
        }
      } else {
        // special case: value on <textarea>
        // 如果节点标签为文本域属性名称为值属性值为真
        if (node.tag === 'textarea' && prop.name === 'value' && prop.value) {
          // 节点值设置为转换后的HTML值
          rawChildrenMap.set(node, escapeHtml(prop.value.content))
          // 如果不需要合并
        } else if (!needMergeProps) {
          // 属性名称为或者属性名称为ref跳过
          if (prop.name === 'key' || prop.name === 'ref') {
            continue
          }
          // static prop
          // 如果属性名称为class与属性值为真
          if (prop.name === 'class' && prop.value) {
            // 静态类绑定指向属性值内容
            staticClassBinding = JSON.stringify(prop.value.content)
          }
          openTag.push(
            ` ${prop.name}` +
              (prop.value ? `="${escapeHtml(prop.value.content)}"` : ``)
          )
        }
      }
    }

    // handle co-existence of dynamic + static class bindings
    // 如果绑定类型静 态类为真
    if (dynamicClassBinding && staticClassBinding) {
      // 合并绑定类与静 态类
      mergeCall(dynamicClassBinding, staticClassBinding)
      // 移除静态类标签
      removeStaticBinding(openTag, 'class')
    }

    if (context.scopeId) {
      openTag.push(` ${context.scopeId}`)
    }
    // 创建标签内容
    node.ssrCodegenNode = createTemplateLiteral(openTag)
  }
}
// 构建SSR属性
export function buildSSRProps(
  props: PropsExpression | undefined,
  directives: DirectiveNode[],
  context: TransformContext
): JSChildNode {
  // 合并属性参数指向空数组
  let mergePropsArgs: JSChildNode[] = []
  // 如果属性为真
  if (props) {
    // 如果属性类型为JS可执行表达式
    if (props.type === NodeTypes.JS_CALL_EXPRESSION) {
      // already a mergeProps call
      // 合并属性参数指向属性参数
      mergePropsArgs = props.arguments as JSChildNode[]
    } else {
      // 合并属性参数压入属性
      mergePropsArgs.push(props)
    }
  }
  // 如果指令长度为真
  if (directives.length) {
    // 循环压入指令
    for (const dir of directives) {
      mergePropsArgs.push(
        createCallExpression(context.helper(SSR_GET_DIRECTIVE_PROPS), [
          `_ctx`,
          ...buildDirectiveArgs(dir, context).elements
        ] as JSChildNode[])
      )
    }
  }
  // 返回创建的属性参数
  return mergePropsArgs.length > 1
    ? createCallExpression(context.helper(MERGE_PROPS), mergePropsArgs)
    : mergePropsArgs[0]
}
// 是布尔值属性
function isTrueFalseValue(prop: DirectiveNode | AttributeNode) {
  if (prop.type === NodeTypes.DIRECTIVE) {
    return (
      prop.name === 'bind' &&
      prop.arg &&
      isStaticExp(prop.arg) &&
      (prop.arg.content === 'true-value' || prop.arg.content === 'false-value')
    )
  } else {
    return prop.name === 'true-value' || prop.name === 'false-value'
  }
}
 // 是文本域值
function isTextareaWithValue(
  node: PlainElementNode,
  prop: DirectiveNode
): boolean {
  return !!(
    node.tag === 'textarea' &&
    prop.name === 'bind' &&
    isStaticArgOf(prop.arg, 'value')
  )
}
// 合并属性
function mergeCall(call: CallExpression, arg: string | JSChildNode) {
  const existing = call.arguments[0] as ExpressionNode | ArrayExpression
  if (existing.type === NodeTypes.JS_ARRAY_EXPRESSION) {
    existing.elements.push(arg)
  } else {
    call.arguments[0] = createArrayExpression([existing, arg])
  }
}
// 移除静态绑定
function removeStaticBinding(
  tag: TemplateLiteral['elements'],
  binding: string
) {
  const regExp = new RegExp(`^ ${binding}=".+"$`)

  const i = tag.findIndex(e => typeof e === 'string' && regExp.test(e))

  if (i > -1) {
    tag.splice(i, 1)
  }
}
// 查找model属性
function findVModel(node: PlainElementNode): DirectiveNode | undefined {
  return node.props.find(
    p => p.type === NodeTypes.DIRECTIVE && p.name === 'model' && p.exp
  ) as DirectiveNode | undefined
}
// SSR元素
export function ssrProcessElement(
  node: PlainElementNode,
  context: SSRTransformContext
) {
  // 是空标签
  const isVoidTag = context.options.isVoidTag || NO
  // 元素添加指向编码节点元素
  const elementsToAdd = node.ssrCodegenNode!.elements
  // 循环压入字符串部分
  for (let j = 0; j < elementsToAdd.length; j++) {
    context.pushStringPart(elementsToAdd[j])
  }

  // Handle slot scopeId
  // 如果SLOT作用域ID为真
  if (context.withSlotScopeId) {
    context.pushStringPart(createSimpleExpression(`_scopeId`, false))
  }

  // close open tag
  // 压入字符串部分
  context.pushStringPart(`>`)
  // 获取节点
  const rawChildren = rawChildrenMap.get(node)
  // 
  if (rawChildren) {
    context.pushStringPart(rawChildren)
  } else if (node.children.length) {
    processChildren(node, context)
  }

  if (!isVoidTag(node.tag)) {
    // push closing tag
    context.pushStringPart(`</${node.tag}>`)
  }
}
