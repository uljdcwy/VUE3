import { ObjectDirective } from '@vue/runtime-core'

interface VShowElement extends HTMLElement {
  // _vod = vue original display
  _vod: string
}

// show指令
export const vShow: ObjectDirective<VShowElement> = {
  // 指令挂载之前
  beforeMount(el, { value }, { transition }) {
    el._vod = el.style.display === 'none' ? '' : el.style.display
    if (transition && value) {
      // 过渡进行之前
      transition.beforeEnter(el)
    } else {
      // 设置显示
      setDisplay(el, value)
    }
  },
  // 持载执行
  mounted(el, { value }, { transition }) {
    if (transition && value) {
      // 过渡进入
      transition.enter(el)
    }
  },
  // 更新
  updated(el, { value, oldValue }, { transition }) {
    if (!value === !oldValue) return
    if (transition) {
      if (value) {
        transition.beforeEnter(el)
        setDisplay(el, true)
        transition.enter(el)
      } else {
        transition.leave(el, () => {
          setDisplay(el, false)
        })
      }
    } else {
      setDisplay(el, value)
    }
  },
  // 卸载之前
  beforeUnmount(el, { value }) {
    setDisplay(el, value)
  }
}

function setDisplay(el: VShowElement, value: unknown): void {
  el.style.display = value ? el._vod : 'none'
}

// SSR vnode transforms, only used when user includes client-oriented render
// function in SSR
// 初始化ssr
export function initVShowForSSR() {
  vShow.getSSRProps = ({ value }) => {
    if (!value) {
      return { style: { display: 'none' } }
    }
  }
}
