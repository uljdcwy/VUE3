import {
  DirectiveTransform,
  DOMErrorCodes,
  createObjectProperty,
  createSimpleExpression,
  createConditionalExpression,
  createObjectExpression,
  createDOMCompilerError
} from '@vue/compiler-dom'
// ssr show 指令转换
export const ssrTransformShow: DirectiveTransform = (dir, node, context) => {
  // 如果指令表达式为假抛出错误
  if (!dir.exp) {
    context.onError(
      createDOMCompilerError(DOMErrorCodes.X_V_SHOW_NO_EXPRESSION)
    )
  }
  // 返回属性
  return {
    props: [
      createObjectProperty(
        `style`,
        createConditionalExpression(
          dir.exp!,
          createSimpleExpression(`null`, false),
          createObjectExpression([
            createObjectProperty(
              `display`,
              createSimpleExpression(`none`, true)
            )
          ]),
          false /* no newline */
        )
      )
    ]
  }
}
