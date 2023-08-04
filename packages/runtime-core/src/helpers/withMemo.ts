import { hasChanged } from '@vue/shared'
import { currentBlock, isBlockTreeEnabled, VNode } from '../vnode'
// 带备忘录
export function withMemo(
  memo: any[],
  render: () => VNode<any, any>,
  cache: any[],
  index: number
) {
  // 获取缓存指向
  const cached = cache[index] as VNode | undefined
  // 如果缓存为真与是Memo同一返回真返回缓存
  if (cached && isMemoSame(cached, memo)) {
    return cached
  }
  // 获取渲染内容
  const ret = render()

  // shallow clone
  // 获取memo投影
  ret.memo = memo.slice()
  // 返回
  return (cache[index] = ret)
}
// 判断值是否有更新
export function isMemoSame(cached: VNode, memo: any[]) {
  const prev: any[] = cached.memo!
  if (prev.length != memo.length) {
    return false
  }

  for (let i = 0; i < prev.length; i++) {
    if (hasChanged(prev[i], memo[i])) {
      return false
    }
  }

  // make sure to let parent block track it when returning cached
  if (isBlockTreeEnabled > 0 && currentBlock) {
    currentBlock.push(cached)
  }
  return true
}
