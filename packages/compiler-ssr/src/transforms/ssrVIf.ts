import {
  createStructuralDirectiveTransform,
  processIf,
  IfNode,
  createIfStatement,
  createBlockStatement,
  createCallExpression,
  IfBranchNode,
  BlockStatement,
  NodeTypes
} from '@vue/compiler-dom'
import {
  SSRTransformContext,
  processChildrenAsStatement
} from '../ssrCodegenTransform'

// Plugin for the first transform pass, which simply constructs the AST node
export const ssrTransformIf = createStructuralDirectiveTransform(
  /^(if|else|else-if)$/,
  processIf
)

// This is called during the 2nd transform pass to construct the SSR-specific
// codegen nodes.
// SSR 进程 IF 
export function ssrProcessIf(
  node: IfNode,
  context: SSRTransformContext,
  disableNestedFragments = false
) {
  //解构出根分支
  const [rootBranch] = node.branches
  // 创建IF语句
  const ifStatement = createIfStatement(
    rootBranch.condition!,
    processIfBranch(rootBranch, context, disableNestedFragments)
  )
  // 上下文对象中压入语句
  context.pushStatement(ifStatement)

  let currentIf = ifStatement
  // 循环节点分支
  for (let i = 1; i < node.branches.length; i++) {
    const branch = node.branches[i]
    const branchBlockStatement = processIfBranch(
      branch,
      context,
      disableNestedFragments
    )
    // 如果是else if 或都 if
    if (branch.condition) {
      // else-if
      // 创建IF语句
      currentIf = currentIf.alternate = createIfStatement(
        branch.condition,
        branchBlockStatement
      )
      // 如果是else
    } else {
      // else
      currentIf.alternate = branchBlockStatement
    }
  }
  // 如果当前IF的备用为假
  if (!currentIf.alternate) {
    // 创建块语句
    currentIf.alternate = createBlockStatement([
      createCallExpression(`_push`, ['`<!---->`'])
    ])
  }
}
// If分支
function processIfBranch(
  branch: IfBranchNode,
  context: SSRTransformContext,
  disableNestedFragments = false
): BlockStatement {
  // 解构子元素
  const { children } = branch
  // 
  const needFragmentWrapper =
    !disableNestedFragments &&
    (children.length !== 1 || children[0].type !== NodeTypes.ELEMENT) &&
    // optimize away nested fragments when the only child is a ForNode
    !(children.length === 1 && children[0].type === NodeTypes.FOR)
    // 返回子节点语句
  return processChildrenAsStatement(branch, context, needFragmentWrapper)
}
