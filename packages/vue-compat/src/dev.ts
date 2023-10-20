import { initCustomFormatter } from '@vue/runtime-dom'
// 初始化开发环境
export function initDev() {
  if (__BROWSER__) {
    if (!__ESM_BUNDLER__) {
      console.info(
        `You are running a development build of Vue.\n` +
          `Make sure to use the production build (*.prod.js) when deploying for production.`
      )
    }
    // 初始化自定义格式
    initCustomFormatter()
  }
}
