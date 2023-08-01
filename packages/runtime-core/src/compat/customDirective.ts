import { isArray } from '@vue/shared'
import { ComponentInternalInstance } from '../component'
import { ObjectDirective, DirectiveHook } from '../directives'
import { softAssertCompatEnabled, DeprecationTypes } from './compatConfig'

export interface LegacyDirective {
  bind?: DirectiveHook
  inserted?: DirectiveHook
  update?: DirectiveHook
  componentUpdated?: DirectiveHook
  unbind?: DirectiveHook
}
// 定义类型
const legacyDirectiveHookMap: Partial<
  Record<
    keyof ObjectDirective,
    keyof LegacyDirective | (keyof LegacyDirective)[]
  >
> = {
  beforeMount: 'bind',
  mounted: 'inserted',
  updated: ['update', 'componentUpdated'],
  unmounted: 'unbind'
}
// 图兼容指令勾子
export function mapCompatDirectiveHook(
  name: keyof ObjectDirective,
  dir: ObjectDirective & LegacyDirective,
  instance: ComponentInternalInstance | null
): DirectiveHook | DirectiveHook[] | undefined {
  // 获取图名称
  const mappedName = legacyDirectiveHookMap[name]
  // 如果图名称为真
  if (mappedName) {
    // 如果是数组
    if (isArray(mappedName)) {
      // 
      const hook: DirectiveHook[] = []
      // 循环图名称
      mappedName.forEach(mapped => {
        // 获取指令勾子
        const mappedHook = dir[mapped]
        // 如果指令勾子为真
        if (mappedHook) {// 
          softAssertCompatEnabled(
            DeprecationTypes.CUSTOM_DIR,
            instance,
            mapped,
            name
          )
          // 构了压入 指令勾子
          hook.push(mappedHook)
        }
      })
      return hook.length ? hook : undefined
    } else {
      if (dir[mappedName]) {
        softAssertCompatEnabled(
          DeprecationTypes.CUSTOM_DIR,
          instance,
          mappedName,
          name
        )
      }
      // 返回指令勾子
      return dir[mappedName]
    }
  }
}
