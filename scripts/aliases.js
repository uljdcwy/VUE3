// @ts-check
// these aliases are shared between vitest and rollup
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// 解析入口循环的包
const resolveEntryForPkg = p =>
  path.resolve(
    fileURLToPath(import.meta.url),
    `../../packages/${p}/src/index.ts`
  )
// 读取目录异步
const dirs = readdirSync(new URL('../packages', import.meta.url))
// 入口指向
const entries = {
  vue: resolveEntryForPkg('vue'),
  'vue/compiler-sfc': resolveEntryForPkg('compiler-sfc'),
  'vue/server-renderer': resolveEntryForPkg('server-renderer'),
  '@vue/compat': resolveEntryForPkg('vue-compat')
}
// 非Src包
const nonSrcPackages = [
  'sfc-playground',
  'size-check',
  'template-explorer',
  'dts-test'
]
// 循环目录
for (const dir of dirs) {
  const key = `@vue/${dir}`
  if (
    dir !== 'vue' &&
    !nonSrcPackages.includes(dir) &&
    !(key in entries) &&
    statSync(new URL(`../packages/${dir}`, import.meta.url)).isDirectory()
  ) {
    entries[key] = resolveEntryForPkg(dir)
  }
}

export { entries }
