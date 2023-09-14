import { RendererOptions } from '@vue/runtime-core'
// SVG的标准
export const svgNS = 'http://www.w3.org/2000/svg'
// 文档对象
const doc = (typeof document !== 'undefined' ? document : null) as Document
// 模版内容
const templateContainer = doc && /*#__PURE__*/ doc.createElement('template')
// 节点选项
export const nodeOps: Omit<RendererOptions<Node, Element>, 'patchProp'> = {
  // 插入节喽
  insert: (child, parent, anchor) => {
    parent.insertBefore(child, anchor || null)
  },
  // 移除节点
  remove: child => {
    const parent = child.parentNode
    if (parent) {
      parent.removeChild(child)
    }
  },
  // 创建节点
  createElement: (tag, isSVG, is, props): Element => {
    const el = isSVG
      ? doc.createElementNS(svgNS, tag)
      : doc.createElement(tag, is ? { is } : undefined)

    if (tag === 'select' && props && props.multiple != null) {
      ;(el as HTMLSelectElement).setAttribute('multiple', props.multiple)
    }

    return el
  },
  // 创建文本节点
  createText: text => doc.createTextNode(text),
  // 创建注释节点
  createComment: text => doc.createComment(text),
  // 设置文本值
  setText: (node, text) => {
    node.nodeValue = text
  },
  // 设置元素文本
  setElementText: (el, text) => {
    el.textContent = text
  },
  // 节点父节点
  parentNode: node => node.parentNode as Element | null,
  // 节点下一下同级节点
  nextSibling: node => node.nextSibling,
  // 查询节点
  querySelector: selector => doc.querySelector(selector),
  // 设作用域ID
  setScopeId(el, id) {
    el.setAttribute(id, '')
  },

  // __UNSAFE__
  // Reason: innerHTML.
  // Static content here can only come from compiled templates.
  // As long as the user only uses trusted templates, this is safe.
  // 插入静态内容
  insertStaticContent(content, parent, anchor, isSVG, start, end) {
    // <parent> before | first ... last | anchor </parent>
    // 获取锚的前一个元素
    const before = anchor ? anchor.previousSibling : parent.lastChild
    // #5308 can only take cached path if:
    // - has a single root node
    // - nextSibling info is still available
    // 如果开始为真与开始等于结束 或开始的下一个同级节点为真
    if (start && (start === end || start.nextSibling)) {
      // cached 缓存一直循环
      while (true) {
        // 在锚位置插入克降的节点
        parent.insertBefore(start!.cloneNode(true), anchor)
        // 如果开始等一结束或者开始的下一个同级节点为假时中断循环
        if (start === end || !(start = start!.nextSibling)) break
      }
    } else {
      // fresh insert 模版内容的 HTML指向
      templateContainer.innerHTML = isSVG ? `<svg>${content}</svg>` : content
      // 获取模版指向
      const template = templateContainer.content
      // 如果是SVG
      if (isSVG) {
        // remove outer svg wrapper 获取模重皮的第一个子元素
        const wrapper = template.firstChild!
        // 循环子第一个子元素
        while (wrapper.firstChild) {
          // 模版中压入子元素
          template.appendChild(wrapper.firstChild)
        }
        // 模版中移除第一个子元素
        template.removeChild(wrapper)
      }
      // 插入模版在锚的位置
      parent.insertBefore(template, anchor)
    }
    // 返回指点一个子节点与最后一个子节点
    return [
      // first
      before ? before.nextSibling! : parent.firstChild!,
      // last
      anchor ? anchor.previousSibling! : parent.lastChild!
    ]
  }
}
