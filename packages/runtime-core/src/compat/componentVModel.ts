import { extend, ShapeFlags } from '@vue/shared'
import { ComponentInternalInstance, ComponentOptions } from '../component'
import { callWithErrorHandling, ErrorCodes } from '../errorHandling'
import { VNode } from '../vnode'
import { popWarningContext, pushWarningContext } from '../warning'
import {
  DeprecationTypes,
  warnDeprecation,
  isCompatEnabled
} from './compatConfig'

export const compatModelEventPrefix = `onModelCompat:`

const warnedTypes = new WeakSet()
// 转换旧版的model属性
export function convertLegacyVModelProps(vnode: VNode) {
  // 解构类型 shapeFlag  属性与活动属性
  const { type, shapeFlag, props, dynamicProps } = vnode
  // 声名类型comp 
  const comp = type as ComponentOptions
  // 如果 shapeFlag 运算 ShapeFlags.COMPONENT 与属笥为真属性中有  modelValue
  if (shapeFlag & ShapeFlags.COMPONENT && props && 'modelValue' in props) {
    // 如果未启用兼容 返回空
    if (
      !isCompatEnabled(
        DeprecationTypes.COMPONENT_V_MODEL,
        // this is a special case where we want to use the vnode component's
        // compat config instead of the current rendering instance (which is the
        // parent of the component that exposes v-model)
        { type } as any
      )
    ) {
      return
    }
    // 如果是开发环境与警告类型没有comp
    if (__DEV__ && !warnedTypes.has(comp)) {
      // 将节点压入警告类型
      pushWarningContext(vnode)
      // 警告描述
      warnDeprecation(DeprecationTypes.COMPONENT_V_MODEL, { type } as any, comp)
      // 弹出警告内容
      popWarningContext()
      // 在警告类型中压入comp
      warnedTypes.add(comp)
    }

    // v3 compiled model code -> v2 compat props
    // modelValue -> value
    // onUpdate:modelValue -> onModelCompat:input
    // 获取model
    const model = comp.model || {}
    // 应用model from mixins 
    applyModelFromMixins(model, comp.mixins)
    // 解构属性与event 并设置默认值
    const { prop = 'value', event = 'input' } = model
    // 如果恪性不  modelValue 
    if (prop !== 'modelValue') {
      // 属性中的属性指向model值
      props[prop] = props.modelValue
      // 删除属性
      delete props.modelValue
    }
    // important: update dynamic props
    // 如果活动属性为真
    if (dynamicProps) {
      // 活动属性中的 获取序列指向prop
      dynamicProps[dynamicProps.indexOf('modelValue')] = prop
    }
    // 属性事件指向
    props[compatModelEventPrefix + event] = props['onUpdate:modelValue']
    // 删除属性事件指向
    delete props['onUpdate:modelValue']
  }
}
// 应用model from 混合
function applyModelFromMixins(model: any, mixins?: ComponentOptions[]) {
  // 如果混合为真
  if (mixins) {
    // 循环混合
    mixins.forEach(m => {
      // 如果m的model为真扩展model  与 m.model
      if (m.model) extend(model, m.model)
      // 如果 m 的混合为真  应用 model from 混合
      if (m.mixins) applyModelFromMixins(model, m.mixins)
    })
  }
}
// 兼容model emit事件
export function compatModelEmit(
  instance: ComponentInternalInstance,
  event: string,
  args: any[]
) {
  // 如果未启有用兼容
  if (!isCompatEnabled(DeprecationTypes.COMPONENT_V_MODEL, instance)) {
    return
  }
  const props = instance.vnode.props
  // 获取绑定的手动
  const modelHandler = props && props[compatModelEventPrefix + event]
  // 如果有手动model
  if (modelHandler) {
    callWithErrorHandling(
      modelHandler,
      instance,
      ErrorCodes.COMPONENT_EVENT_HANDLER,
      args
    )
  }
}
