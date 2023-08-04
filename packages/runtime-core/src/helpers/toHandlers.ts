import { toHandlerKey, isObject } from '@vue/shared'
import { warn } from '../warning'

/**
 * For prefixing keys in v-on="obj" with "on"
 * @private
 */
// 
export function toHandlers(
  obj: Record<string, any>,
  preserveCaseIfNecessary?: boolean
): Record<string, any> {
  const ret: Record<string, any> = {};
  // 如果是开发环境与不是对象，输入警告并返回
  if (__DEV__ && !isObject(obj)) {
    warn(`v-on with no argument expects an object value.`)
    return ret
  }
  // 循环对象
  for (const key in obj) {
    ret[
      preserveCaseIfNecessary && /[A-Z]/.test(key)
        ? `on:${key}`
        : toHandlerKey(key)
    ] = obj[key]
  }
  // 返回 ret 
  return ret
}
