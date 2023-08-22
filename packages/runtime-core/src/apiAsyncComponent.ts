import {
  Component,
  ConcreteComponent,
  currentInstance,
  ComponentInternalInstance,
  isInSSRComponentSetup,
  ComponentOptions
} from './component'
import { isFunction, isObject } from '@vue/shared'
import { ComponentPublicInstance } from './componentPublicInstance'
import { createVNode, VNode } from './vnode'
import { defineComponent } from './apiDefineComponent'
import { warn } from './warning'
import { ref } from '@vue/reactivity'
import { handleError, ErrorCodes } from './errorHandling'
import { isKeepAlive } from './components/KeepAlive'
import { queueJob } from './scheduler'

export type AsyncComponentResolveResult<T = Component> = T | { default: T } // es modules

export type AsyncComponentLoader<T = any> = () => Promise<
  AsyncComponentResolveResult<T>
>

export interface AsyncComponentOptions<T = any> {
  loader: AsyncComponentLoader<T>
  loadingComponent?: Component
  errorComponent?: Component
  delay?: number
  timeout?: number
  suspensible?: boolean
  onError?: (
    error: Error,
    retry: () => void,
    fail: () => void,
    attempts: number
  ) => any
}
// 判断是异步的外层
export const isAsyncWrapper = (i: ComponentInternalInstance | VNode): boolean =>
  !!(i.type as ComponentOptions).__asyncLoader
// 默认的异步组件
export function defineAsyncComponent<
  T extends Component = { new (): ComponentPublicInstance }
>(source: AsyncComponentLoader<T> | AsyncComponentOptions<T>): T {
  // 判断资源是函数 如果是给资源加加载
  if (isFunction(source)) {
    source = { loader: source }
  }
  // 解构资源中的加载加载组件有时其他
  const {
    loader,
    loadingComponent,
    errorComponent,
    delay = 200,
    timeout, // undefined = never times out
    suspensible = true,
    onError: userOnError
  } = source
  // 等待请求状态初始化为空
  let pendingRequest: Promise<ConcreteComponent> | null = null
  // 初始化为未定义
  let resolvedComp: ConcreteComponent | undefined
  // 初始化组件加载失败的重试资数
  let retries = 0
  // 入口方法
  const retry = () => {
    // 重试模式自增
    retries++
    // 等待请求设置为空
    pendingRequest = null
    // 加载组件
    return load()
  }
  // 加载方法返回一个Promise回调
  const load = (): Promise<ConcreteComponent> => {
    let thisRequest: Promise<ConcreteComponent>
    // 如果等待请求状态为真，返回等待请求，否则等待请求指向Promise
    return (
      pendingRequest ||
      (thisRequest = pendingRequest =
        loader()
          .catch(err => {
            err = err instanceof Error ? err : new Error(String(err))
            // 如果报错，返回错误
            if (userOnError) {
              return new Promise((resolve, reject) => {
                const userRetry = () => resolve(retry())
                const userFail = () => reject(err)
                userOnError(err, userRetry, userFail, retries + 1)
              })
            } else {
              throw err
            }
          })
          .then((comp: any) => {
            // 如果条件为真此时发生竞态了，抛充指定内容反回等待的请求
            if (thisRequest !== pendingRequest && pendingRequest) {
              return pendingRequest
            }
            // 如果是开发环境与，不是组件抛出错误
            if (__DEV__ && !comp) {
              warn(
                `Async component loader resolved to undefined. ` +
                  `If you are using retry(), make sure to return its return value.`
              )
            }
            // interop module default
            // 如果组件为真，与组件ES模块为真，与组件是MODULE， 组件指向默认导出
            if (
              comp &&
              (comp.__esModule || comp[Symbol.toStringTag] === 'Module')
            ) {
              comp = comp.default
            }
            // 验证组件
            if (__DEV__ && comp && !isObject(comp) && !isFunction(comp)) {
              throw new Error(`Invalid async component load result: ${comp}`)
            }
            resolvedComp = comp
            // 返回加载的组件
            return comp
          }))
    )
  }
  // 返回默认组件
  return defineComponent({
    //
    name: 'AsyncComponentWrapper',
    // 异步加载指向方法
    __asyncLoader: load,
    // get方法指向
    get __asyncResolved() {
      return resolvedComp
    },
    //安装方法指向
    setup() {
      // 指向上下文对象
      const instance = currentInstance!

      // already resolved
      // 如果组件比罗为真
      if (resolvedComp) {
        // 返回创建的内部比较
        return () => createInnerComp(resolvedComp!, instance)
      }
      // 错误函数指向
      const onError = (err: Error) => {
        pendingRequest = null
        handleError(
          err,
          instance,
          ErrorCodes.ASYNC_COMPONENT_LOADER,
          !errorComponent /* do not throw in dev if user provided error component */
        )
      }

      // suspense-controlled or SSR.
      if (
        (__FEATURE_SUSPENSE__ && suspensible && instance.suspense) ||
        (__SSR__ && isInSSRComponentSetup)
      ) {
        return load()
          .then(comp => {
            // 返回创建的内容组件
            return () => createInnerComp(comp, instance)
          })
          .catch(err => {
            onError(err)
            return () =>
              errorComponent
                ? createVNode(errorComponent as ConcreteComponent, {
                    error: err
                  })
                : null
          })
      }
      // 加载状态
      const loaded = ref(false)
      // 错误状态
      const error = ref()
      // 延时指向
      const delayed = ref(!!delay)

      if (delay) {
        // 延时
        setTimeout(() => {
          delayed.value = false
        }, delay)
      }
      // 如果延时不为空
      if (timeout != null) {
        setTimeout(() => {
          // 如果没有加载到值抛出错误
          if (!loaded.value && !error.value) {
            const err = new Error(
              `Async component timed out after ${timeout}ms.`
            )
            onError(err)
            error.value = err
          }
        }, timeout)
      }

      load()
        .then(() => {
          // 加载值初始化为真
          loaded.value = true
          // 如果上下文对象的parent为真与是缓存内容
          if (instance.parent && isKeepAlive(instance.parent.vnode)) {
            // parent is keep-alive, force update so the loaded component's
            // name is taken into account
            // 在队列中加入更新方法
            queueJob(instance.parent.update)
          }
        })
        .catch(err => {
          onError(err)
          error.value = err
        })

      return () => {
        // 如果加载值为真，与
        if (loaded.value && resolvedComp) {
          // 返回创建的内容
          return createInnerComp(resolvedComp, instance)
        } else if (error.value && errorComponent) {
          return createVNode(errorComponent, {
            error: error.value
          })
        } else if (loadingComponent && !delayed.value) {
          // 返回创建的内容
          return createVNode(loadingComponent)
        }
      }
    }
  }) as T
}
// 创建内容方法
function createInnerComp(
  comp: ConcreteComponent,
  parent: ComponentInternalInstance
) {
  const { ref, props, children, ce } = parent.vnode
  const vnode = createVNode(comp, props, children)
  // ensure inner component inherits the async wrapper's ref owner
  vnode.ref = ref
  // pass the custom element callback on to the inner comp
  // and remove it from the async wrapper
  vnode.ce = ce
  delete parent.vnode.ce
  // 返回节点
  return vnode
}
