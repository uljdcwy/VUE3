import {
  includeBooleanAttr,
  isSpecialBooleanAttr,
  makeMap,
  NOOP
} from '@vue/shared'
import {
  compatUtils,
  ComponentInternalInstance,
  DeprecationTypes
} from '@vue/runtime-core'

export const xlinkNS = 'http://www.w3.org/1999/xlink'
// 更新属性
export function patchAttr(
  el: Element,
  key: string,
  value: any,
  isSVG: boolean,
  instance?: ComponentInternalInstance | null
) {
  // 如果是SVG 在键里找xlink: 如果有
  if (isSVG && key.startsWith('xlink:')) {
    // 如果值为空
    if (value == null) {
      // 在元素移除 xlinkNS 
      el.removeAttributeNS(xlinkNS, key.slice(6, key.length))
    } else {
      // 设置属性 xlinkNS 的键设置为值
      el.setAttributeNS(xlinkNS, key, value)
    }
  } else {
    // 如果兼容存在与兼容核心属性el key value instance为真
    if (__COMPAT__ && compatCoerceAttr(el, key, value, instance)) {
      return
    }

    // note we are only checking boolean attributes that don't have a
    // corresponding dom prop of the same name here. 判断是特殊的布尔属性
    const isBoolean = isSpecialBooleanAttr(key)
    // 如果值为空或都是布尔值与布尔属性里的值为假
    if (value == null || (isBoolean && !includeBooleanAttr(value))) {
      // 移除键
      el.removeAttribute(key)
    } else {
      // 元素更新属性
      el.setAttribute(key, isBoolean ? '' : value)
    }
  }
}

// 2.x compat 判断是枚举属性
const isEnumeratedAttr = __COMPAT__
  ? /*#__PURE__*/ makeMap('contenteditable,draggable,spellcheck')
  : NOOP
// 兼容核心属性
export function compatCoerceAttr(
  el: Element,
  key: string,
  value: unknown,
  instance: ComponentInternalInstance | null = null
): boolean {
  // 如果是枚举属性
  if (isEnumeratedAttr(key)) {
    const v2CoercedValue =
      value === null
        ? 'false'
        : typeof value !== 'boolean' && value !== undefined
        ? 'true'
        : null;
        
        // 如果V0核 心值为真与兼容启为
    if (
      v2CoercedValue &&
      compatUtils.softAssertCompatEnabled(
        DeprecationTypes.ATTR_ENUMERATED_COERCION,
        instance,
        key,
        value,
        v2CoercedValue
      )
    ) {
      // 设置属性
      el.setAttribute(key, v2CoercedValue)
      return true
    }
  } else if (
    value === false &&
    !isSpecialBooleanAttr(key) &&
    compatUtils.softAssertCompatEnabled(
      DeprecationTypes.ATTR_FALSE_VALUE,
      instance,
      key
    )
  ) {
    // 移除属性
    el.removeAttribute(key)
    return true
  }
  return false
}
