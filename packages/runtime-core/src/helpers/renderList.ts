import { VNode, VNodeChild } from '../vnode'
import { isArray, isString, isObject } from '@vue/shared'
import { warn } from '../warning'

/**
 * v-for string
 * @private
 */
export function renderList(
  source: string,
  renderItem: (value: string, index: number) => VNodeChild
): VNodeChild[]

/**
 * v-for number
 */
export function renderList(
  source: number,
  renderItem: (value: number, index: number) => VNodeChild
): VNodeChild[]

/**
 * v-for array
 */
export function renderList<T>(
  source: T[],
  renderItem: (value: T, index: number) => VNodeChild
): VNodeChild[]

/**
 * v-for iterable
 */
export function renderList<T>(
  source: Iterable<T>,
  renderItem: (value: T, index: number) => VNodeChild
): VNodeChild[]

/**
 * v-for object
 */
// 定义函数的类
export function renderList<T>(
  source: T,
  renderItem: <K extends keyof T>(
    value: T[K],
    key: K,
    index: number
  ) => VNodeChild
): VNodeChild[]

/**
 * Actual implementation
 */
// 渲染列表方法
export function renderList(
  source: any,
  renderItem: (...args: any[]) => VNodeChild,
  cache?: any[],
  index?: number
): VNodeChild[] {
  let ret: VNodeChild[]
  // 获取渲染缓存
  const cached = (cache && cache[index!]) as VNode[] | undefined
  // 如果渲染资源是数组或者是字符串
  if (isArray(source) || isString(source)) {
    // 新建一个资源长度的数组
    ret = new Array(source.length)
    // 循环资源
    for (let i = 0, l = source.length; i < l; i++) {
      // 获取渲染出来的item
      ret[i] = renderItem(source[i], i, undefined, cached && cached[i])
    }
    // 如果资源是数字
  } else if (typeof source === 'number') {
    // 输入警告
    if (__DEV__ && !Number.isInteger(source)) {
      warn(`The v-for range expect an integer value but got ${source}.`)
    }
    // 泻染出数字
    ret = new Array(source)
    for (let i = 0; i < source; i++) {
      ret[i] = renderItem(i + 1, i, undefined, cached && cached[i])
    }
    // 如果资源是对象
  } else if (isObject(source)) {
    // 如果是不重复对象
    if (source[Symbol.iterator as any]) {
      // 数组化渲染出来的对象
      ret = Array.from(source as Iterable<any>, (item, i) =>
        renderItem(item, i, undefined, cached && cached[i])
      )
    } else {
      const keys = Object.keys(source)
      ret = new Array(keys.length)
      for (let i = 0, l = keys.length; i < l; i++) {
        const key = keys[i]
        // 渲染出 item 对象
        ret[i] = renderItem(source[key], key, i, cached && cached[i])
      }
    }
  } else {
    // 清空ret
    ret = []
  }
  // 缓存指向
  if (cache) {
    cache[index!] = ret
  }
  // 返回 ret
  return ret
}
