import { isString, hyphenate, capitalize, isArray } from '@vue/shared'
import { camelize, warn } from '@vue/runtime-core'

type Style = string | Record<string, string | string[]> | null
// 更新样式
export function patchStyle(el: Element, prev: Style, next: Style) {
  // 获取元素的样式属笥
  const style = (el as HTMLElement).style
  // 判断next是否是字符串
  const isCssString = isString(next)
  // 如果next 与不是字符串
  if (next && !isCssString) {
    // 如果 prev与 prev不是字符串
    if (prev && !isString(prev)) {
      // 循环 prev 
      for (const key in prev) {
        // 如果next 中的 key 为空
        if (next[key] == null) {
          // 设置样式的值
          setStyle(style, key, '')
        }
      }
    }
    // 循环next 中的key 更新值
    for (const key in next) {
      setStyle(style, key, next[key])
    }
  } else {
    // 获取display 属性
    const currentDisplay = style.display
    // 如果是字符串
    if (isCssString) {
      // 如果前一个与下一个不相等
      if (prev !== next) {
        // 样式的CSS文本指向next
        style.cssText = next as string
      }
      // 否则如果prev为真元素移除样式属性
    } else if (prev) {
      el.removeAttribute('style')
    }
    // indicates that the `display` of the element is controlled by `v-show`,
    // so we always keep the current `display` value regardless of the `style`
    // value, thus handing over control to `v-show`.
    // 如果_vod  在 el中
    if ('_vod' in el) {
      // 样式display 指向当前显示
      style.display = currentDisplay
    }
  }
}

const semicolonRE = /[^\\];\s*$/
const importantRE = /\s*!important$/
// 设置样式
function setStyle(
  style: CSSStyleDeclaration,
  name: string,
  val: string | string[]
) {
  // 如果值是数组
  if (isArray(val)) {
    // 循环递归设置样式
    val.forEach(v => setStyle(style, name, v))
  } else {
    // 如果值为空，值设置为""
    if (val == null) val = ''
    // 如果是开发环境
    if (__DEV__) {
      // 匹配值合法
      if (semicolonRE.test(val)) {
        warn(
          `Unexpected semicolon at the end of '${name}' style value: '${val}'`
        )
      }
    }
    // 如果名称中有 --
    if (name.startsWith('--')) {
      // custom property definition 设置属性
      style.setProperty(name, val)
    } else {
      // 获取前缀
      const prefixed = autoPrefix(style, name)
      // 如果值中有import 
      if (importantRE.test(val)) {
        // !important 设置属笥加 import
        style.setProperty(
          hyphenate(prefixed),
          val.replace(importantRE, ''),
          'important'
        )
      } else {
        // 设置样式的指定属性为值
        style[prefixed as any] = val
      }
    }
  }
}

const prefixes = ['Webkit', 'Moz', 'ms']
const prefixCache: Record<string, string> = {}
// 自动前缀
function autoPrefix(style: CSSStyleDeclaration, rawName: string): string {
  // 获取缓存在的rawName
  const cached = prefixCache[rawName]
  // 如果缓存为真返回缓存
  if (cached) {
    return cached
  }
  // 驼峰化名称
  let name = camelize(rawName)
  // 如果名称不是 filter 与名称在style
  if (name !== 'filter' && name in style) {
    // 前缀中缓存更新
    return (prefixCache[rawName] = name)
  }
  // 大写名称
  name = capitalize(name)
  // 循环前缀
  for (let i = 0; i < prefixes.length; i++) {
    // 加入前缀
    const prefixed = prefixes[i] + name
    // 前缀在样式中时
    if (prefixed in style) {
      // 返回更新前缀
      return (prefixCache[rawName] = prefixed)
    }
  }
  // 返回名称
  return rawName
}
