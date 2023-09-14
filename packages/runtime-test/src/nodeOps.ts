import { markRaw } from '@vue/reactivity'

export const enum TestNodeTypes {
  TEXT = 'text',
  ELEMENT = 'element',
  COMMENT = 'comment'
}

export const enum NodeOpTypes {
  CREATE = 'create',
  INSERT = 'insert',
  REMOVE = 'remove',
  SET_TEXT = 'setText',
  SET_ELEMENT_TEXT = 'setElementText',
  PATCH = 'patch'
}

export interface TestElement {
  id: number
  type: TestNodeTypes.ELEMENT
  parentNode: TestElement | null
  tag: string
  children: TestNode[]
  props: Record<string, any>
  eventListeners: Record<string, Function | Function[]> | null
}

export interface TestText {
  id: number
  type: TestNodeTypes.TEXT
  parentNode: TestElement | null
  text: string
}

export interface TestComment {
  id: number
  type: TestNodeTypes.COMMENT
  parentNode: TestElement | null
  text: string
}

export type TestNode = TestElement | TestText | TestComment

export interface NodeOp {
  type: NodeOpTypes
  nodeType?: TestNodeTypes
  tag?: string
  text?: string
  targetNode?: TestNode
  parentNode?: TestElement
  refNode?: TestNode | null
  propKey?: string
  propPrevValue?: any
  propNextValue?: any
}

let nodeId: number = 0
let recordedNodeOps: NodeOp[] = []
// 导出日志节点选项
export function logNodeOp(op: NodeOp) {
  // 记录节点选项压入选项
  recordedNodeOps.push(op)
}
// 重置选项
export function resetOps() {
  recordedNodeOps = []
}
// 下载选项
export function dumpOps(): NodeOp[] {
  const ops = recordedNodeOps.slice()
  resetOps()
  return ops
}
// 创建元素
function createElement(tag: string): TestElement {
  const node: TestElement = {
    id: nodeId++,
    type: TestNodeTypes.ELEMENT,
    tag,
    children: [],
    props: {},
    parentNode: null,
    eventListeners: null
  }
  // 日志节点选项
  logNodeOp({
    type: NodeOpTypes.CREATE,
    nodeType: TestNodeTypes.ELEMENT,
    targetNode: node,
    tag
  })
  // avoid test nodes from being observed 标记 RAW节点
  markRaw(node)
  return node
}
// 创建文本
function createText(text: string): TestText {
  const node: TestText = {
    id: nodeId++,
    type: TestNodeTypes.TEXT,
    text,
    parentNode: null
  }
  // 日志
  logNodeOp({
    type: NodeOpTypes.CREATE,
    nodeType: TestNodeTypes.TEXT,
    targetNode: node,
    text
  })
  // avoid test nodes from being observed
  markRaw(node)
  return node
}
// 创建注释节点
function createComment(text: string): TestComment {
  const node: TestComment = {
    id: nodeId++,
    type: TestNodeTypes.COMMENT,
    text,
    parentNode: null
  }
  logNodeOp({
    type: NodeOpTypes.CREATE,
    nodeType: TestNodeTypes.COMMENT,
    targetNode: node,
    text
  })
  // avoid test nodes from being observed
  markRaw(node)
  return node
}
// 设置文本
function setText(node: TestText, text: string) {
  logNodeOp({
    type: NodeOpTypes.SET_TEXT,
    targetNode: node,
    text
  })
  node.text = text
}
// 插入
function insert(child: TestNode, parent: TestElement, ref?: TestNode | null) {
  let refIndex
  if (ref) {
    refIndex = parent.children.indexOf(ref)
    if (refIndex === -1) {
      console.error('ref: ', ref)
      console.error('parent: ', parent)
      throw new Error('ref is not a child of parent')
    }
  }
  logNodeOp({
    type: NodeOpTypes.INSERT,
    targetNode: child,
    parentNode: parent,
    refNode: ref
  })
  // remove the node first, but don't log it as a REMOVE op
  remove(child, false)
  // re-calculate the ref index because the child's removal may have affected it
  refIndex = ref ? parent.children.indexOf(ref) : -1
  if (refIndex === -1) {
    parent.children.push(child)
    child.parentNode = parent
  } else {
    parent.children.splice(refIndex, 0, child)
    child.parentNode = parent
  }
}

function remove(child: TestNode, logOp = true) {
  const parent = child.parentNode
  if (parent) {
    if (logOp) {
      logNodeOp({
        type: NodeOpTypes.REMOVE,
        targetNode: child,
        parentNode: parent
      })
    }
    const i = parent.children.indexOf(child)
    if (i > -1) {
      parent.children.splice(i, 1)
    } else {
      console.error('target: ', child)
      console.error('parent: ', parent)
      throw Error('target is not a childNode of parent')
    }
    child.parentNode = null
  }
}
// 设置元素文本
function setElementText(el: TestElement, text: string) {
  logNodeOp({
    type: NodeOpTypes.SET_ELEMENT_TEXT,
    targetNode: el,
    text
  })
  el.children.forEach(c => {
    c.parentNode = null
  })
  if (!text) {
    el.children = []
  } else {
    el.children = [
      {
        id: nodeId++,
        type: TestNodeTypes.TEXT,
        text,
        parentNode: el
      }
    ]
  }
}
// 获取上级节点
function parentNode(node: TestNode): TestElement | null {
  return node.parentNode
}
// 获取下一个同级节点
function nextSibling(node: TestNode): TestNode | null {
  const parent = node.parentNode
  if (!parent) {
    return null
  }
  const i = parent.children.indexOf(node)
  return parent.children[i + 1] || null
}
// 查询方法
function querySelector(): never {
  throw new Error('querySelector not supported in test renderer.')
}
// 设置作用域ID
function setScopeId(el: TestElement, id: string) {
  el.props[id] = ''
}
// 导出方法
export const nodeOps = {
  insert,
  remove,
  createElement,
  createText,
  createComment,
  setText,
  setElementText,
  parentNode,
  nextSibling,
  querySelector,
  setScopeId
}
