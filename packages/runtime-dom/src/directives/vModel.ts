import {
  ObjectDirective,
  VNode,
  DirectiveHook,
  DirectiveBinding,
  warn
} from '@vue/runtime-core'
import { addEventListener } from '../modules/events'
import {
  isArray,
  looseEqual,
  looseIndexOf,
  invokeArrayFns,
  looseToNumber,
  isSet
} from '@vue/shared'

type AssignerFn = (value: any) => void
// 获取model 的类型
const getModelAssigner = (vnode: VNode): AssignerFn => {
  const fn =
    vnode.props!['onUpdate:modelValue'] ||
    (__COMPAT__ && vnode.props!['onModelCompat:input'])
    // 如果是数组，调用数组 
  return isArray(fn) ? value => invokeArrayFns(fn, value) : fn
}
// 合成开始时
function onCompositionStart(e: Event) {
  ;(e.target as any).composing = true
}

// 合成结束时
function onCompositionEnd(e: Event) {
  const target = e.target as any
  if (target.composing) {
    target.composing = false
    // 更新事件
    target.dispatchEvent(new Event('input'))
  }
}

type ModelDirective<T> = ObjectDirective<T & { _assign: AssignerFn }>

// We are exporting the v-model runtime directly as vnode hooks so that it can
// be tree-shaken in case v-model is never used. 绑定的节点文本
export const vModelText: ModelDirective<
  HTMLInputElement | HTMLTextAreaElement
> = {
  // 创建
  created(el, { modifiers: { lazy, trim, number } }, vnode) {
    el._assign = getModelAssigner(vnode)
    const castToNumber =
      number || (vnode.props && vnode.props.type === 'number')
      // 添加监听改变与INPUT
    addEventListener(el, lazy ? 'change' : 'input', e => {
      if ((e.target as any).composing) return
      let domValue: string | number = el.value
      if (trim) {
        // 获取DOM值
        domValue = domValue.trim()
      }
      if (castToNumber) {
        // 转换DOM值到数字
        domValue = looseToNumber(domValue)
      }
      el._assign(domValue)
    })
    if (trim) {
      // 如果空格为真监听改变事件
      addEventListener(el, 'change', () => {
        el.value = el.value.trim()
      })
    }
    if (!lazy) {
      // 监听事件
      addEventListener(el, 'compositionstart', onCompositionStart)
      addEventListener(el, 'compositionend', onCompositionEnd)
      // Safari < 10.2 & UIWebView doesn't fire compositionend when
      // switching focus before confirming composition choice
      // this also fixes the issue where some browsers e.g. iOS Chrome
      // fires "change" instead of "input" on autocomplete.
      addEventListener(el, 'change', onCompositionEnd)
    }
  },
  // set value on mounted so it's after min/max for type="range" 挂载时
  mounted(el, { value }) {
    el.value = value == null ? '' : value
  },
  // 更新前
  beforeUpdate(el, { value, modifiers: { lazy, trim, number } }, vnode) {
    el._assign = getModelAssigner(vnode)
    // avoid clearing unresolved text. #2302
    if ((el as any).composing) return
    // 如果是池围属性
    if (document.activeElement === el && el.type !== 'range') {
      if (lazy) {
        return
      }
      if (trim && el.value.trim() === value) {
        return
      }
      if (
        (number || el.type === 'number') &&
        looseToNumber(el.value) === value
      ) {
        return
      }
    }
    const newValue = value == null ? '' : value
    if (el.value !== newValue) {
      // 更新元素的值
      el.value = newValue
    }
  }
}
// 绑定checkbox
export const vModelCheckbox: ModelDirective<HTMLInputElement> = {
  // #4096 array checkboxes need to be deep traversed 深度设置为真
  deep: true,
  //创建
  created(el, _, vnode) {
    el._assign = getModelAssigner(vnode)
    // 监听改变
    addEventListener(el, 'change', () => {
      // 获取绑定的值
      const modelValue = (el as any)._modelValue
      // 获取元素值
      const elementValue = getValue(el)
      const checked = el.checked
      const assign = el._assign
      if (isArray(modelValue)) {
        const index = looseIndexOf(modelValue, elementValue)
        const found = index !== -1
        if (checked && !found) {
          assign(modelValue.concat(elementValue))
        } else if (!checked && found) {
          const filtered = [...modelValue]
          filtered.splice(index, 1)
          assign(filtered)
        }
      } else if (isSet(modelValue)) {
        const cloned = new Set(modelValue)
        if (checked) {
          cloned.add(elementValue)
        } else {
          cloned.delete(elementValue)
        }
        assign(cloned)
      } else {
        assign(getCheckboxValue(el, checked))
      }
    })
  },
  // set initial checked on mount to wait for true-value/false-value
  // 挂载时执行的方法
  mounted: setChecked,
  // 更新前执行的方法
  beforeUpdate(el, binding, vnode) {
    el._assign = getModelAssigner(vnode)
    setChecked(el, binding, vnode)
  }
}
// 设置值
function setChecked(
  el: HTMLInputElement,
  { value, oldValue }: DirectiveBinding,
  vnode: VNode
) {
  // store the v-model value on the element so it can be accessed by the
  // change listener.
  ;(el as any)._modelValue = value
  if (isArray(value)) {
    el.checked = looseIndexOf(value, vnode.props!.value) > -1
  } else if (isSet(value)) {
    el.checked = value.has(vnode.props!.value)
  } else if (value !== oldValue) {
    el.checked = looseEqual(value, getCheckboxValue(el, true))
  }
}
// 绑定radio
export const vModelRadio: ModelDirective<HTMLInputElement> = {
  // 创建方法
  created(el, { value }, vnode) {
    el.checked = looseEqual(value, vnode.props!.value)
    el._assign = getModelAssigner(vnode)
    // 监听改变
    addEventListener(el, 'change', () => {
      el._assign(getValue(el))
    })
  },
  // 更新前执行
  beforeUpdate(el, { value, oldValue }, vnode) {
    el._assign = getModelAssigner(vnode)
    if (value !== oldValue) {
      el.checked = looseEqual(value, vnode.props!.value)
    }
  }
}
// 绑定 select 
export const vModelSelect: ModelDirective<HTMLSelectElement> = {
  // <select multiple> value need to be deep traversed
  deep: true,
  // 创建时
  created(el, { value, modifiers: { number } }, vnode) {
    const isSetModel = isSet(value)
    addEventListener(el, 'change', () => {
      const selectedVal = Array.prototype.filter
        .call(el.options, (o: HTMLOptionElement) => o.selected)
        .map((o: HTMLOptionElement) =>
          number ? looseToNumber(getValue(o)) : getValue(o)
        )
      el._assign(
        el.multiple
          ? isSetModel
            ? new Set(selectedVal)
            : selectedVal
          : selectedVal[0]
      )
    })
    el._assign = getModelAssigner(vnode)
  },
  // set value in mounted & updated because <select> relies on its children
  // <option>s. 挂载时
  mounted(el, { value }) {
    setSelected(el, value)
  },
  // 更新前
  beforeUpdate(el, _binding, vnode) {
    el._assign = getModelAssigner(vnode)
  },
  // 更新时
  updated(el, { value }) {
    setSelected(el, value)
  }
}
// 设置选择值
function setSelected(el: HTMLSelectElement, value: any) {
  const isMultiple = el.multiple
  if (isMultiple && !isArray(value) && !isSet(value)) {
    __DEV__ &&
      warn(
        `<select multiple v-model> expects an Array or Set value for its binding, ` +
          `but got ${Object.prototype.toString.call(value).slice(8, -1)}.`
      )
    return
  }
  for (let i = 0, l = el.options.length; i < l; i++) {
    const option = el.options[i]
    const optionValue = getValue(option)
    if (isMultiple) {
      if (isArray(value)) {
        option.selected = looseIndexOf(value, optionValue) > -1
      } else {
        option.selected = value.has(optionValue)
      }
    } else {
      if (looseEqual(getValue(option), value)) {
        if (el.selectedIndex !== i) el.selectedIndex = i
        return
      }
    }
  }
  if (!isMultiple && el.selectedIndex !== -1) {
    el.selectedIndex = -1
  }
}

// retrieve raw value set via :value bindings 获取值
function getValue(el: HTMLOptionElement | HTMLInputElement) {
  return '_value' in el ? (el as any)._value : el.value
}

// retrieve raw value for true-value and false-value set via :true-value or :false-value bindings 获取checkbox的值
function getCheckboxValue(
  el: HTMLInputElement & { _trueValue?: any; _falseValue?: any },
  checked: boolean
) {
  const key = checked ? '_trueValue' : '_falseValue'
  return key in el ? el[key] : checked
}
// 绑定动态时
export const vModelDynamic: ObjectDirective<
  HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
> = {
  // 创建
  created(el, binding, vnode) {
    callModelHook(el, binding, vnode, null, 'created')
  },
  // 挂载
  mounted(el, binding, vnode) {
    callModelHook(el, binding, vnode, null, 'mounted')
  },
  // 更新前
  beforeUpdate(el, binding, vnode, prevVNode) {
    callModelHook(el, binding, vnode, prevVNode, 'beforeUpdate')
  },
  // 更新
  updated(el, binding, vnode, prevVNode) {
    callModelHook(el, binding, vnode, prevVNode, 'updated')
  }
}
// 移除动态绑定
function resolveDynamicModel(tagName: string, type: string | undefined) {
  switch (tagName) {
    case 'SELECT':
      return vModelSelect
    case 'TEXTAREA':
      return vModelText
    default:
      switch (type) {
        case 'checkbox':
          return vModelCheckbox
        case 'radio':
          return vModelRadio
        default:
          return vModelText
      }
  }
}
// 执行绑定勾子
function callModelHook(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  binding: DirectiveBinding,
  vnode: VNode,
  prevVNode: VNode | null,
  hook: keyof ObjectDirective
) {
  // 解析动态绑定
  const modelToUse = resolveDynamicModel(
    el.tagName,
    vnode.props && vnode.props.type
  )
  const fn = modelToUse[hook] as DirectiveHook
  // 如果函数为真执行
  fn && fn(el, binding, vnode, prevVNode)
}

// SSR vnode transforms, only used when user includes client-oriented render
// function in SSR 初始化绑定的循环SSR
export function initVModelForSSR() {
  // 获取绑定文本SSR属笥
  vModelText.getSSRProps = ({ value }) => ({ value })
  // 获取radio的SSR属性
  vModelRadio.getSSRProps = ({ value }, vnode) => {
    if (vnode.props && looseEqual(vnode.props.value, value)) {
      return { checked: true }
    }
  }
  // 获取checkbox的SSR属性
  vModelCheckbox.getSSRProps = ({ value }, vnode) => {
    if (isArray(value)) {
      if (vnode.props && looseIndexOf(value, vnode.props.value) > -1) {
        return { checked: true }
      }
    } else if (isSet(value)) {
      if (vnode.props && value.has(vnode.props.value)) {
        return { checked: true }
      }
    } else if (value) {
      return { checked: true }
    }
  }
  // 获取动态的SSR属性
  vModelDynamic.getSSRProps = (binding, vnode) => {
    if (typeof vnode.type !== 'string') {
      return
    }
    const modelToUse = resolveDynamicModel(
      // resolveDynamicModel expects an uppercase tag name, but vnode.type is lowercase
      vnode.type.toUpperCase(),
      vnode.props && vnode.props.type
    )
    if (modelToUse.getSSRProps) {
      return modelToUse.getSSRProps(binding, vnode)
    }
  }
}
