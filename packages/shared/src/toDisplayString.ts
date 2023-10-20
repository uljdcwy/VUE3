import {
  isArray,
  isMap,
  isObject,
  isFunction,
  isPlainObject,
  isSet,
  objectToString,
  isString
} from './general'

/**
 * For converting {{ interpolation }} values to displayed strings.
 * @private 到显示字符串
 */
export const toDisplayString = (val: unknown): string => {
  // 如果值是字符串 返回值否则判值为空如果是返回 '' 否判断是数组，或都是对象返回字符串化的数据，否则字符串化值
  return isString(val)
    ? val
    : val == null
    ? ''
    : isArray(val) ||
      (isObject(val) &&
        (val.toString === objectToString || !isFunction(val.toString)))
    ? JSON.stringify(val, replacer, 2)
    : String(val)
}

/**
 * 
 * @param _key 字符串
 * @param val 任意参数
 * @returns 返回值
 */
const replacer = (_key: string, val: any): any => {
  // can't use isRef here since @vue/shared has no deps
  // 如果值为真与值是一个ref
  if (val && val.__v_isRef) {
    // 递值调用替换
    return replacer(_key, val.value)
    // 否则如果值是Map
  } else if (isMap(val)) {
    // 返回对象
    return {
      [`Map(${val.size})`]: [...val.entries()].reduce((entries, [key, val]) => {
        ;(entries as any)[`${key} =>`] = val
        return entries
      }, {})
    }
    // 如果是Set
  } else if (isSet(val)) {
    // 返回set函数
    return {
      [`Set(${val.size})`]: [...val.values()]
    }
    // 如果是对象与不是数组与不是plainObj返回字符串化值
  } else if (isObject(val) && !isArray(val) && !isPlainObject(val)) {
    return String(val)
  }
  // 返回值
  return val
}
