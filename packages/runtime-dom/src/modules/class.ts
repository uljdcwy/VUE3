import { ElementWithTransition } from '../components/Transition'

// compiler should normalize class + :class bindings on the same element
// into a single binding ['staticClass', dynamic] 更新类
export function patchClass(el: Element, value: string | null, isSVG: boolean) {
  // directly setting className should be faster than setAttribute in theory
  // if this is an element during a transition, take the temporary transition
  // classes into account.
  const transitionClasses = (el as ElementWithTransition)._vtc
  if (transitionClasses) {
    value = (
      value ? [value, ...transitionClasses] : [...transitionClasses]
    ).join(' ')
  }
  // 如果值不存在移除属性类
  if (value == null) {
    el.removeAttribute('class')
    // 如果是SVG 设置属性
  } else if (isSVG) {
    el.setAttribute('class', value)
  } else {
    // 元素类指向值
    el.className = value
  }
}
