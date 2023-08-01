import { isOn } from '@vue/shared'
import { ComponentInternalInstance } from '../component'
import { DeprecationTypes, isCompatEnabled } from './compatConfig'
// 应该跳过的属性 
export function shouldSkipAttr(
  key: string,
  instance: ComponentInternalInstance
): boolean {
  // 如果key是is跳过属性
  if (key === 'is') {
    return true
  }
  // 如果key是class 或者是style 与是启用兼容，跳过属性
  if (
    (key === 'class' || key === 'style') &&
    isCompatEnabled(DeprecationTypes.INSTANCE_ATTRS_CLASS_STYLE, instance)
  ) {
    return true
  }
  // 如果key是on 与启用兼容 跳过属性
  if (
    isOn(key) &&
    isCompatEnabled(DeprecationTypes.INSTANCE_LISTENERS, instance)
  ) {
    return true
  }
  // vue-router
  // 搜索路由视图 或者key是注册路由上下文对象跳过
  if (key.startsWith('routerView') || key === 'registerRouteInstance') {
    return true
  }
  // 否则不跳过
  return false
}
