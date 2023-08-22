import { computed as _computed } from '@vue/reactivity'
import { isInSSRComponentSetup } from './component'
// 计算属性方法API 导出
export const computed: typeof _computed = (
  getterOrOptions: any,
  debugOptions?: any
) => {
  // @ts-ignore
  return _computed(getterOrOptions, debugOptions, isInSSRComponentSetup)
}
