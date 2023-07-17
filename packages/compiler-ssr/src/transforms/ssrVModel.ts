import {
  DirectiveTransform,
  ElementTypes,
  transformModel,
  findProp,
  NodeTypes,
  createDOMCompilerError,
  DOMErrorCodes,
  createObjectProperty,
  createSimpleExpression,
  createCallExpression,
  PlainElementNode,
  ExpressionNode,
  createConditionalExpression,
  createInterpolation,
  hasDynamicKeyVBind
} from '@vue/compiler-dom'
import {
  SSR_LOOSE_EQUAL,
  SSR_LOOSE_CONTAIN,
  SSR_RENDER_DYNAMIC_MODEL
} from '../runtimeHelpers'
import { DirectiveTransformResult } from 'packages/compiler-core/src/transform'
// SSR 转换Model
export const ssrTransformModel: DirectiveTransform = (dir, node, context) => {
  // 获取指令表达式
  const model = dir.exp!

// 检查value属性如果有此属性则报错
  function checkDuplicatedValue() {

    const value = findProp(node, 'value')
    if (value) {
      context.onError(
        createDOMCompilerError(
          DOMErrorCodes.X_V_MODEL_UNNECESSARY_VALUE,
          value.loc
        )
      )
    }
  }
// 如果节点标签灰型为元素
  if (node.tagType === ElementTypes.ELEMENT) {
    const res: DirectiveTransformResult = { props: [] }
    // 默认属性为创建的对象属性，此时说明标签为input
    const defaultProps = [
      // default value binding for text type inputs
      createObjectProperty(`value`, model)
    ]
    // 如果节点为input
    if (node.tag === 'input') {
      // 查找节点的type
      const type = findProp(node, 'type')
      if (type) {
        // 查找绑定值
        const value = findValueBinding(node)
        if (type.type === NodeTypes.DIRECTIVE) {
          // dynamic type
          // res的 SSR标签部分为创建的表达式
          res.ssrTagParts = [
            createCallExpression(context.helper(SSR_RENDER_DYNAMIC_MODEL), [
              type.exp!,
              model,
              value
            ])
          ]
          // 如果type的值为真
        } else if (type.value) {
          // static type
          // 传入type值 创建对象表达式
          switch (type.value.content) {
            case 'radio':
              res.props = [
                createObjectProperty(
                  `checked`,
                  createCallExpression(context.helper(SSR_LOOSE_EQUAL), [
                    model,
                    value
                  ])
                )
              ]
              break
            case 'checkbox':
              const trueValueBinding = findProp(node, 'true-value')
              if (trueValueBinding) {
                const trueValue =
                  trueValueBinding.type === NodeTypes.ATTRIBUTE
                    ? JSON.stringify(trueValueBinding.value!.content)
                    : trueValueBinding.exp!
                res.props = [
                  createObjectProperty(
                    `checked`,
                    createCallExpression(context.helper(SSR_LOOSE_EQUAL), [
                      model,
                      trueValue
                    ])
                  )
                ]
              } else {
                res.props = [
                  createObjectProperty(
                    `checked`,
                    createConditionalExpression(
                      createCallExpression(`Array.isArray`, [model]),
                      createCallExpression(context.helper(SSR_LOOSE_CONTAIN), [
                        model,
                        value
                      ]),
                      model
                    )
                  )
                ]
              }
              break
            case 'file':
              context.onError(
                createDOMCompilerError(
                  DOMErrorCodes.X_V_MODEL_ON_FILE_INPUT_ELEMENT,
                  dir.loc
                )
              )
              break
            default:
              checkDuplicatedValue()
              res.props = defaultProps
              break
          }
        }
      } else if (hasDynamicKeyVBind(node)) {
        // dynamic type due to dynamic v-bind
        // NOOP, handled in ssrTransformElement due to need to rewrite
        // the entire props expression
      } else {
        // text type
        // 检查是不绑定value
        checkDuplicatedValue()
        res.props = defaultProps
      }
    } else if (node.tag === 'textarea') {
      checkDuplicatedValue()
      node.children = [createInterpolation(model, model.loc)]
    } else if (node.tag === 'select') {
      // NOOP
      // select relies on client-side directive to set initial selected state.
    } else {
      context.onError(
        createDOMCompilerError(
          DOMErrorCodes.X_V_MODEL_ON_INVALID_ELEMENT,
          dir.loc
        )
      )
    }

    return res
  } else {
    // component v-model
    // 转换model绑定
    return transformModel(dir, node, context)
  }
}
// 查找值绑定
function findValueBinding(node: PlainElementNode): ExpressionNode {
  const valueBinding = findProp(node, 'value')
  return valueBinding
    ? valueBinding.type === NodeTypes.DIRECTIVE
      ? valueBinding.exp!
      : createSimpleExpression(valueBinding.value!.content, true)
    : createSimpleExpression(`null`, false)
}
