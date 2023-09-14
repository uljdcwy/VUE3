// __UNSAFE__
// Reason: potentially setting innerHTML.
// This can come from explicit usage of v-html or innerHTML as a prop in render

import { warn, DeprecationTypes, compatUtils } from '@vue/runtime-core'
import { includeBooleanAttr } from '@vue/shared'

// functions. The user is responsible for using them with only trusted content. 更新DOM属笥
export function patchDOMProp(
  el: any,
  key: string,
  value: any,
  // the following args are passed only due to potential innerHTML/textContent
  // overriding existing VNodes, in which case the old tree must be properly
  // unmounted.
  prevChildren: any,
  parentComponent: any,
  parentSuspense: any,
  unmountChildren: any
) {
  // 如果键是innerHTML 或者 textContent
  if (key === 'innerHTML' || key === 'textContent') {
    // 如果前一个子节点为真时
    if (prevChildren) {
      // 卸载子节点
      unmountChildren(prevChildren, parentComponent, parentSuspense)
    }
    // 元素键指 "" 或者值
    el[key] = value == null ? '' : value
    return
  }
  // 获取元素标签
  const tag = el.tagName
  // 如果键指向值与标签不为 PROGRESS 与 标签查找-为假时
  if (
    key === 'value' &&
    tag !== 'PROGRESS' &&
    // custom elements may use _value internally
    !tag.includes('-')
  ) {
    // store value as _value as well since
    // non-string values will be stringified.
    // 元素值指向值
    el._value = value
    // #4956: <option> value will fallback to its text content so we need to
    // compare against its attribute value instead.
    // 获取早值
    const oldValue = tag === 'OPTION' ? el.getAttribute('value') : el.value
    // 新值指向
    const newValue = value == null ? '' : value
    // 早值不为新值是元素值指向新值
    if (oldValue !== newValue) {
      el.value = newValue
    }
    // 如果值为空
    if (value == null) {
      // 元素移除属性
      el.removeAttribute(key)
    }
    return
  }
  // 需要移除指向false
  let needRemove = false
  // 如果值为 "" 或者 null
  if (value === '' || value == null) {
    // 获取值类型
    const type = typeof el[key]
    // 如果是布尔值
    if (type === 'boolean') {
      // e.g. <select multiple> compiles to { multiple: '' } 找到布尔属性 multiple
      value = includeBooleanAttr(value)
      // 如果值为空 与类型为字符串
    } else if (value == null && type === 'string') {
      // e.g. <div :id="null">
      // 值指向 ""
      value = ''
      // 需要移除指向true
      needRemove = true
    // 如果类型为数字
    } else if (type === 'number') {
      // e.g. <img :width="null">
      // 值指向0
      value = 0
      needRemove = true
    }
  } else {
    // 如果兼容启用为真，与值为false与是启用兼容 
    if (
      __COMPAT__ &&
      value === false &&
      compatUtils.isCompatEnabled(
        DeprecationTypes.ATTR_FALSE_VALUE,
        parentComponent
      )
    ) {
      const type = typeof el[key]
      if (type === 'string' || type === 'number') {
        __DEV__ &&
          compatUtils.warnDeprecation(
            DeprecationTypes.ATTR_FALSE_VALUE,
            parentComponent,
            key
          )
          // 值类型为数字
        value = type === 'number' ? 0 : ''
        needRemove = true
      }
    }
  }

  // some properties perform value validation and throw,
  // some properties has getter, no setter, will error in 'use strict'
  // eg. <select :type="null"></select> <select :willValidate="null"></select>
  try {
    // 元素键指向值
    el[key] = value
  } catch (e: any) {
    // do not warn if value is auto-coerced from nullish values
    if (__DEV__ && !needRemove) {
      warn(
        `Failed setting prop "${key}" on <${tag.toLowerCase()}>: ` +
          `value ${value} is invalid.`,
        e
      )
    }
  }
  // 移除属性如果需要移除
  needRemove && el.removeAttribute(key)
}
