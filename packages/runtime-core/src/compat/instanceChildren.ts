import { ShapeFlags } from '@vue/shared'
import { ComponentInternalInstance } from '../component'
import { ComponentPublicInstance } from '../componentPublicInstance'
import { VNode } from '../vnode'
import { assertCompatEnabled, DeprecationTypes } from './compatConfig'
// 获取兼容子元素
export function getCompatChildren(
  instance: ComponentInternalInstance
): ComponentPublicInstance[] {
  assertCompatEnabled(DeprecationTypes.INSTANCE_CHILDREN, instance)
  const root = instance.subTree
  const children: ComponentPublicInstance[] = []
  if (root) {
    walk(root, children)
  }
  return children
}
// 漫步方法
function walk(vnode: VNode, children: ComponentPublicInstance[]) {
  // 如果节点是组件在子元素中压入节点代理对象
  if (vnode.component) {
    children.push(vnode.component.proxy!)
    // 否则循环节点并递入
  } else if (vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
    const vnodes = vnode.children as VNode[]
    for (let i = 0; i < vnodes.length; i++) {
      walk(vnodes[i], children)
    }
  }
}
