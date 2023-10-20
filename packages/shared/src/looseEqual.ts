import { isArray, isDate, isObject, isSymbol } from './general'
// 松散比较数组
function looseCompareArrays(a: any[], b: any[]) {
  if (a.length !== b.length) return false
  let equal = true
  // 循环a 长度
  for (let i = 0; equal && i < a.length; i++) {
    // 判断松散等比
    equal = looseEqual(a[i], b[i])
  }
  // 返回平等
  return equal
}
// 松散平等方法
export function looseEqual(a: any, b: any): boolean {
  // 如果a 等于 b 返回真
  if (a === b) return true
  // 如果是日期
  let aValidType = isDate(a)
  // 如果是日期
  let bValidType = isDate(b)
  // 如果其中有珍上是日期返回时间毫秒
  if (aValidType || bValidType) {
    return aValidType && bValidType ? a.getTime() === b.getTime() : false
  }
  // 判断是单独对象
  aValidType = isSymbol(a)
  // 判断是单独对象
  bValidType = isSymbol(b)
  /// 如果有一个为真返回比较值
  if (aValidType || bValidType) {
    return a === b
  }
  // 判断是数组
  aValidType = isArray(a)
  // 判断是数组
  bValidType = isArray(b)
  // 如果有珍上是数组递归调用松散比较数组 
  if (aValidType || bValidType) {
    return aValidType && bValidType ? looseCompareArrays(a, b) : false
  }
  // 如查是对象
  aValidType = isObject(a)
  // 如果是对象
  bValidType = isObject(b)
  // 如果其中有一个是对象
  if (aValidType || bValidType) {
    /* istanbul ignore if: this if will probably never be called */
    // 如果有一个不是对象返回假
    if (!aValidType || !bValidType) {
      return false
    }
    // 获取键数
    const aKeysCount = Object.keys(a).length
    const bKeysCount = Object.keys(b).length
    // 如果键数不相等返回假
    if (aKeysCount !== bKeysCount) {
      return false
    }
    for (const key in a) {
      const aHasKey = a.hasOwnProperty(key)
      const bHasKey = b.hasOwnProperty(key)
      if (
        (aHasKey && !bHasKey) ||
        (!aHasKey && bHasKey) ||
        !looseEqual(a[key], b[key])
      ) {
        // 返回假
        return false
      }
    }
  }
  return String(a) === String(b)
}
// 松散索引
export function looseIndexOf(arr: any[], val: any): number {
  return arr.findIndex(item => looseEqual(item, val))
}
