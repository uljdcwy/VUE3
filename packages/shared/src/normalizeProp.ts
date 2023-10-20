import { isArray, isString, isObject, hyphenate } from './general'

export type NormalizedStyle = Record<string, string | number>
// 规格式样式
export function normalizeStyle(
  value: unknown
): NormalizedStyle | string | undefined {
  // 如果值是数组
  if (isArray(value)) {
    const res: NormalizedStyle = {}
    // 循环值长度
    for (let i = 0; i < value.length; i++) {
      // 获取item指向
      const item = value[i]
      // 如果item是字符串格式化字符串样式否则零规格式样式
      const normalized = isString(item)
        ? parseStringStyle(item)
        : (normalizeStyle(item) as NormalizedStyle)
      // 如果规格式为真
      if (normalized) {
        // 循环规格式
        for (const key in normalized) {
          // 建立规格式对象键值对
          res[key] = normalized[key]
        }
      }
    }
    return res
    // 如果值是字符串或都是对象
  } else if (isString(value) || isObject(value)) {
    // 返回值
    return value
  }
}

const listDelimiterRE = /;(?![^(]*\))/g
const propertyDelimiterRE = /:([^]+)/
const styleCommentRE = /\/\*[^]*?\*\//g
// 解析字符串样式
export function parseStringStyle(cssText: string): NormalizedStyle {
  // ret指向对象
  const ret: NormalizedStyle = {}
  // css文本替换注释为空 切割 例表，循环
  cssText
    .replace(styleCommentRE, '')
    .split(listDelimiterRE)
    .forEach(item => {
      if (item) {
        const tmp = item.split(propertyDelimiterRE)
        tmp.length > 1 && (ret[tmp[0].trim()] = tmp[1].trim())
      }
    })
    // 返回样式对象
  return ret
}
// 字符串样式
export function stringifyStyle(
  styles: NormalizedStyle | string | undefined
): string {
  let ret = ''
  // 如果为假，或者是字符串 返回res
  if (!styles || isString(styles)) {
    return ret
  }
  // 循环styles
  for (const key in styles) {
    //  获取值的指向
    const value = styles[key]
    // 规格式键，
    const normalizedKey = key.startsWith(`--`) ? key : hyphenate(key)
    // 如果值是字符串或都值是数字
    if (isString(value) || typeof value === 'number') {
      // only render valid values
      // 拼接样式
      ret += `${normalizedKey}:${value};`
    }
  }
  // 返回 ret
  return ret
}
// 规格式类
export function normalizeClass(value: unknown): string {
  // 初始化拼接值为 ''
  let res = ''
  // 如果值是字符串
  if (isString(value)) {
    // 拼接值
    res = value
    // 如果值是数组
  } else if (isArray(value)) {
    // 循环值
    for (let i = 0; i < value.length; i++) {
      // 获取规格化类
      const normalized = normalizeClass(value[i])
      // 如果返回值为真
      if (normalized) {
        // 拼接规格化值
        res += normalized + ' '
      }
    }
    // 如果值是对象
  } else if (isObject(value)) {
    // 循环值
    for (const name in value) {
      // 如果值存在拼接
      if (value[name]) {
        res += name + ' '
      }
    }
  }
  // 清除两端空格返回
  return res.trim()
}
// 规格化属性
export function normalizeProps(props: Record<string, any> | null) {
  // 如果属性为假返回空
  if (!props) return null
  let { class: klass, style } = props
  // 如果klass 为假与是字符串为真
  if (klass && !isString(klass)) {
    // 属性类指向规格化的类
    props.class = normalizeClass(klass)
  }
  // 如果样式为真
  if (style) {
    // 属性样式指向规格化样式
    props.style = normalizeStyle(style)
  }
  // 返回属性
  return props
}
