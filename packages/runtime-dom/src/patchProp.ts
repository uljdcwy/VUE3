import { patchClass } from './modules/class'
import { patchStyle } from './modules/style'
import { patchAttr } from './modules/attrs'
import { patchDOMProp } from './modules/props'
import { patchEvent } from './modules/events'
import { isOn, isString, isFunction, isModelListener } from '@vue/shared'
import { RendererOptions } from '@vue/runtime-core'

const nativeOnRE = /^on[a-z]/

type DOMRendererOptions = RendererOptions<Node, Element>
// 更新属性
export const patchProp: DOMRendererOptions['patchProp'] = (
  el,
  key,
  prevValue,
  nextValue,
  isSVG = false,
  prevChildren,
  parentComponent,
  parentSuspense,
  unmountChildren
) => {
  // 如果键是类
  if (key === 'class') {
    // 调用更新类方法
    patchClass(el, nextValue, isSVG)
    // 如果是样式调用更新样式方法
  } else if (key === 'style') {
    patchStyle(el, prevValue, nextValue)
    // 如果是事件，
  } else if (isOn(key)) {
    // ignore v-model listeners 如果是未知绑定的监听
    if (!isModelListener(key)) {
      // 更新事件
      patchEvent(el, key, prevValue, nextValue, parentComponent)
    }
  } else if (
    key[0] === '.'
      ? ((key = key.slice(1)), true)
      : key[0] === '^'
      ? ((key = key.slice(1)), false)
      : shouldSetAsProp(el, key, nextValue, isSVG)
  ) {
    // 更新DOM属性
    patchDOMProp(
      el,
      key,
      nextValue,
      prevChildren,
      parentComponent,
      parentSuspense,
      unmountChildren
    )
    // 束则
  } else {
    // special case for <input v-model type="checkbox"> with
    // :true-value & :false-value
    // store value as dom properties since non-string values will be
    // stringified. 如果键为真值
    if (key === 'true-value') {
      // 元素的真值设置为下一个值
      ;(el as any)._trueValue = nextValue
    // 如果键是假值
    } else if (key === 'false-value') {
      // 假值设置为下一个值
      ;(el as any)._falseValue = nextValue
    }
    // 更新属性
    patchAttr(el, key, nextValue, isSVG, parentComponent)
  }
}
// 应该设置为属性
function shouldSetAsProp(
  el: Element,
  key: string,
  value: unknown,
  isSVG: boolean
) {
  // 如果是SVG
  if (isSVG) {
    // most keys must be set as attribute on svg elements to work
    // ...except innerHTML & textContent 如果键是innerhtml与textContent返回值
    if (key === 'innerHTML' || key === 'textContent') {
      return true
    }
    // or native onclick with function values 如果键在元素中事件修饰符与值是函数返回值
    if (key in el && nativeOnRE.test(key) && isFunction(value)) {
      return true
    }
    // 返回假
    return false
  }

  // these are enumerated attrs, however their corresponding DOM properties
  // are actually booleans - this leads to setting it with a string "false"
  // value leading it to be coerced to `true`, so we need to always treat
  // them as attributes.
  // Note that `contentEditable` doesn't have this problem: its DOM
  // property is also enumerated string values. 如果键为特定值返回假
  if (key === 'spellcheck' || key === 'draggable' || key === 'translate') {
    return false
  }

  // #1787, #2840 form property on form elements is readonly and must be set as
  // attribute. 如果键是form返回假
  if (key === 'form') {
    return false
  }

  // #1526 <input list> must be set as attribute 如果键是list与标签名称为input返回假
  if (key === 'list' && el.tagName === 'INPUT') {
    return false
  }

  // #2766 <textarea type> must be set as attribute 如果争冠是类型与标签名称为textarea反回假
  if (key === 'type' && el.tagName === 'TEXTAREA') {
    return false
  }

  // native onclick with string value, must be set as attribute 如果修饰符在有键与值是字符串返回假
  if (nativeOnRE.test(key) && isString(value)) {
    return false
  }
// 返回键是否在元素中的判断
  return key in el 
}
