import { isFunction, isObject } from '@vue/shared'
import { Component, ComponentInternalInstance } from '../component'
import {
  checkCompatEnabled,
  DeprecationTypes,
  softAssertCompatEnabled
} from './compatConfig'
import { convertLegacyAsyncComponent } from './componentAsync'
import { convertLegacyFunctionalComponent } from './componentFunctional'
// 转换遗留功能组件
export function convertLegacyComponent(
  comp: any,
  instance: ComponentInternalInstance | null
): Component {
  if (comp.__isBuiltIn) {
    return comp
  }
  // 如果是函数，与cid为真指向选项
  // 2.x constructor
  if (isFunction(comp) && comp.cid) {
    comp = comp.options
  }

  // 2.x async component
  if (
    isFunction(comp) &&
    checkCompatEnabled(DeprecationTypes.COMPONENT_ASYNC, instance, comp)
  ) {
    // since after disabling this, plain functions are still valid usage, do not
    // use softAssert here.
    // 转换异步的组件
    return convertLegacyAsyncComponent(comp)
  }

  // 2.x functional component
  // 如果是对象静态启用兼容
  if (
    isObject(comp) &&
    comp.functional &&
    softAssertCompatEnabled(
      DeprecationTypes.COMPONENT_FUNCTIONAL,
      instance,
      comp
    )
  ) {
    return convertLegacyFunctionalComponent(comp)
  }

  return comp
}
