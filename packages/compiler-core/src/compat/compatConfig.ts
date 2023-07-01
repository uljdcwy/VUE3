import { SourceLocation } from '../ast'
import { CompilerError } from '../errors'
import { ParserContext } from '../parse'
import { TransformContext } from '../transform'


// 编译兼容配置 配置 MODE 的类型设置为 弃用类型的值
export type CompilerCompatConfig = Partial<
  Record<CompilerDeprecationTypes, boolean | 'suppress-warning'>
> & {
  MODE?: 2 | 3
}
// 声名接口编译兼容选项 
export interface CompilerCompatOptions {
  compatConfig?: CompilerCompatConfig
}
// 弃用类型枚举值
export const enum CompilerDeprecationTypes {
  COMPILER_IS_ON_ELEMENT = 'COMPILER_IS_ON_ELEMENT',
  COMPILER_V_BIND_SYNC = 'COMPILER_V_BIND_SYNC',
  COMPILER_V_BIND_PROP = 'COMPILER_V_BIND_PROP',
  COMPILER_V_BIND_OBJECT_ORDER = 'COMPILER_V_BIND_OBJECT_ORDER',
  COMPILER_V_ON_NATIVE = 'COMPILER_V_ON_NATIVE',
  COMPILER_V_IF_V_FOR_PRECEDENCE = 'COMPILER_V_IF_V_FOR_PRECEDENCE',
  COMPILER_NATIVE_TEMPLATE = 'COMPILER_NATIVE_TEMPLATE',
  COMPILER_INLINE_TEMPLATE = 'COMPILER_INLINE_TEMPLATE',
  COMPILER_FILTERS = 'COMPILER_FILTER'
}
// 充用类型数据类型
type DeprecationData = {
  message: string | ((...args: any[]) => string)
  link?: string
}
// 充用类型类型指定的值声名  
const deprecationData: Record<CompilerDeprecationTypes, DeprecationData> = {
  // 
  [CompilerDeprecationTypes.COMPILER_IS_ON_ELEMENT]: {
    message:
      `带有IS属性的原生元素不在被视为组件，除非IS值明确带有前缀`,
    link: `https://v3-migration.vuejs.org/breaking-changes/custom-elements-interop.html`
  },

  [CompilerDeprecationTypes.COMPILER_V_BIND_SYNC]: {
    message: key =>
      `带有v-bind的.sync修饰符已被删除，例 v-bind:${key}.sync 应使用v-model:${key}`,
    link: `https://v3-migration.vuejs.org/breaking-changes/v-model.html`
  },

  [CompilerDeprecationTypes.COMPILER_V_BIND_PROP]: {
    message:
      `v-bind绑定属性前缀已不需要VUE会在适当的时候将其绑定设置为DOM属性`
  },

  [CompilerDeprecationTypes.COMPILER_V_BIND_OBJECT_ORDER]: {
    message:
      `V-bind="obj" 用法对顺序敏感，并且行为类似于js中的对象扩展，如果发生冲突，它将覆盖v-bind之前出现的现有不可合并属性，要保留 2.x行为，请移动v-bind以使其成为第一个属性`,
    link: `https://v3-migration.vuejs.org/breaking-changes/v-bind.html`
  },

  [CompilerDeprecationTypes.COMPILER_V_ON_NATIVE]: {
    message: `事件的.native修饰符已被删除，因为不在需要`,
    link: `https://v3-migration.vuejs.org/breaking-changes/v-on-native-modifier-removed.html`
  },

  [CompilerDeprecationTypes.COMPILER_V_IF_V_FOR_PRECEDENCE]: {
    message:
      `v-if 在同一个元素中比v-for有更高的优先级，应避免在同一元素使用,或使用计算属性过滤数据`,
    link: `https://v3-migration.vuejs.org/breaking-changes/v-if-v-for.html`
  },

  [CompilerDeprecationTypes.COMPILER_NATIVE_TEMPLATE]: {
    message:
      `没有特殊指令的原生模重皮将呈现为原生模版` +
      `element instead of its inner content in Vue 3.`
  },

  [CompilerDeprecationTypes.COMPILER_INLINE_TEMPLATE]: {
    message: `inline-template 在VUE3中删除`,
    link: `https://v3-migration.vuejs.org/breaking-changes/inline-template-attribute.html`
  },

  [CompilerDeprecationTypes.COMPILER_FILTERS]: {
    message:
      `VUE3 中已删除过滤器，| 将被视为本机的js or运算符`,
    link: `https://v3-migration.vuejs.org/breaking-changes/filters.html`
  }
}
// 获取兼容值 在VUE3 中compatConfig 指向  CompilerDeprecationTypes 枚举 此时获取的是枚举值
function getCompatValue(
  key: CompilerDeprecationTypes | 'MODE',
  context: ParserContext | TransformContext
) {
  const config = (context as ParserContext).options
    ? (context as ParserContext).options.compatConfig
    : (context as TransformContext).compatConfig
  const value = config && config[key]
  if (key === 'MODE') {
    return value || 3 // compiler defaults to v3 behavior
  } else {
    return value
  }
}
//  是否启用兼容
export function isCompatEnabled(
  key: CompilerDeprecationTypes,
  context: ParserContext | TransformContext
) {
  // 如果全局配置与选项属性中没有 MODE 返回 3 否则返回枚举值
  const mode = getCompatValue('MODE', context)
  // 
  const value = getCompatValue(key, context)
  // in v3 mode, only enable if explicitly set to true
  // otherwise enable for any non-false value
  return mode === 3 ? value === true : value !== false
}
// 检查兼容启用
export function checkCompatEnabled(
  key: CompilerDeprecationTypes,
  context: ParserContext | TransformContext,
  loc: SourceLocation | null,
  ...args: any[]
): boolean {
  const enabled = isCompatEnabled(key, context)
  if (__DEV__ && enabled) {
    warnDeprecation(key, context, loc, ...args)
  }
  return enabled
}

export function warnDeprecation(
  key: CompilerDeprecationTypes,
  context: ParserContext | TransformContext,
  loc: SourceLocation | null,
  ...args: any[]
) {
  const val = getCompatValue(key, context)
  if (val === 'suppress-warning') {
    return
  }
  // 获取消息与连接
  const { message, link } = deprecationData[key]
  const msg = `(deprecation ${key}) ${
    typeof message === 'function' ? message(...args) : message
  }${link ? `\n  Details: ${link}` : ``}`
  // 新建错误对象
  const err = new SyntaxError(msg) as CompilerError
  err.code = key
  if (loc) err.loc = loc
  // 输入警告
  context.onWarn(err)
}
