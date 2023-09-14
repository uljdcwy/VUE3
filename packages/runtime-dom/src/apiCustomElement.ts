import {
  ComponentOptionsMixin,
  ComponentOptionsWithArrayProps,
  ComponentOptionsWithObjectProps,
  ComponentOptionsWithoutProps,
  ComponentPropsOptions,
  ComponentPublicInstance,
  ComputedOptions,
  EmitsOptions,
  MethodOptions,
  RenderFunction,
  SetupContext,
  ComponentInternalInstance,
  VNode,
  RootHydrateFunction,
  ExtractPropTypes,
  createVNode,
  defineComponent,
  nextTick,
  warn,
  ConcreteComponent,
  ComponentOptions,
  ComponentInjectOptions,
  SlotsType
} from '@vue/runtime-core'
import { camelize, extend, hyphenate, isArray, toNumber } from '@vue/shared'
import { hydrate, render } from '.'

export type VueElementConstructor<P = {}> = {
  new (initialProps?: Record<string, any>): VueElement & P
}

// defineCustomElement provides the same type inference as defineComponent
// so most of the following overloads should be kept in sync w/ defineComponent.

// overload 1: direct setup function
export function defineCustomElement<Props, RawBindings = object>(
  setup: (
    props: Readonly<Props>,
    ctx: SetupContext
  ) => RawBindings | RenderFunction
): VueElementConstructor<Props>

// overload 2: object format with no props
export function defineCustomElement<
  Props = {},
  RawBindings = {},
  D = {},
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  E extends EmitsOptions = EmitsOptions,
  EE extends string = string,
  I extends ComponentInjectOptions = {},
  II extends string = string,
  S extends SlotsType = {}
>(
  options: ComponentOptionsWithoutProps<
    Props,
    RawBindings,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    EE,
    I,
    II,
    S
  > & { styles?: string[] }
): VueElementConstructor<Props>

// overload 3: object format with array props declaration
export function defineCustomElement<
  PropNames extends string,
  RawBindings,
  D,
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  E extends EmitsOptions = Record<string, any>,
  EE extends string = string,
  I extends ComponentInjectOptions = {},
  II extends string = string,
  S extends SlotsType = {}
>(
  options: ComponentOptionsWithArrayProps<
    PropNames,
    RawBindings,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    EE,
    I,
    II,
    S
  > & { styles?: string[] }
): VueElementConstructor<{ [K in PropNames]: any }>

// overload 4: object format with object props declaration
export function defineCustomElement<
  PropsOptions extends Readonly<ComponentPropsOptions>,
  RawBindings,
  D,
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  E extends EmitsOptions = Record<string, any>,
  EE extends string = string,
  I extends ComponentInjectOptions = {},
  II extends string = string,
  S extends SlotsType = {}
>(
  options: ComponentOptionsWithObjectProps<
    PropsOptions,
    RawBindings,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    EE,
    I,
    II,
    S
  > & { styles?: string[] }
): VueElementConstructor<ExtractPropTypes<PropsOptions>>

// overload 5: defining a custom element from the returned value of
// `defineComponent`
export function defineCustomElement(options: {
  new (...args: any[]): ComponentPublicInstance
}): VueElementConstructor
// 默认的自定义元素
export function defineCustomElement(
  options: any,
  hydrate?: RootHydrateFunction
): VueElementConstructor {
  // 获取组件
  const Comp = defineComponent(options) as any
  // 扩展类
  class VueCustomElement extends VueElement {
    static def = Comp
    constructor(initialProps?: Record<string, any>) {
      super(Comp, initialProps, hydrate)
    }
  }
  // 返回扩展类
  return VueCustomElement
}
// 默认的SSR自定义元素
export const defineSSRCustomElement = ((options: any) => {
  // @ts-ignore 返回默认的自定义元素
  return defineCustomElement(options, hydrate)
}) as typeof defineCustomElement

const BaseClass = (
  typeof HTMLElement !== 'undefined' ? HTMLElement : class {}
) as typeof HTMLElement

type InnerComponentDef = ConcreteComponent & { styles?: string[] }

export class VueElement extends BaseClass {
  /**
   * @internal
   */
  _instance: ComponentInternalInstance | null = null

  private _connected = false
  private _resolved = false
  private _numberProps: Record<string, true> | null = null
  private _styles?: HTMLStyleElement[]
  // 新建时的方法
  constructor(
    private _def: InnerComponentDef,
    private _props: Record<string, any> = {},
    hydrate?: RootHydrateFunction
  ) {
    // 执行继承
    super()
    // 如果投影根与激活为真
    if (this.shadowRoot && hydrate) {
      // 激活创建节点
      hydrate(this._createVNode(), this.shadowRoot)
    } else {
      // 如果是开发环境 发出警告
      if (__DEV__ && this.shadowRoot) {
        warn(
          `Custom element has pre-rendered declarative shadow root but is not ` +
            `defined as hydratable. Use \`defineSSRCustomElement\`.`
        )
      }
      // 更新mode
      this.attachShadow({ mode: 'open' })
      // 异步加载
      if (!(this._def as ComponentOptions).__asyncLoader) {
        // for sync component defs we can immediately resolve props 解析属性s
        this._resolveProps(this._def)
      }
    }
  }
  // 连接回调
  connectedCallback() {
    // 连接状态为真
    this._connected = true
    // 上下文对象为假时
    if (!this._instance) {
      // 解析为真时
      if (this._resolved) {
        // 更新
        this._update()
      } else {
        // 解析
        this._resolveDef()
      }
    }
  }
  // 销毁连接回调
  disconnectedCallback() {
    // 销毁指向false
    this._connected = false
    // nextTick
    nextTick(() => {
      // 如果连接为false
      if (!this._connected) {
        // 渲染
        render(null, this.shadowRoot!)
        // 上下文对象设置为空
        this._instance = null
      }
    })
  }

  /**
   * resolve inner component definition (handle possible async component)
   */
  // 解析Def
  private _resolveDef() {
    // 将解析设置为真
    this._resolved = true

    // set initial attrs 循环属性列表
    for (let i = 0; i < this.attributes.length; i++) {
      // 设置属性
      this._setAttr(this.attributes[i].name)
    }

    // watch future attr changes
    // 新建DOM观查对象观查变化设置属性
    new MutationObserver(mutations => {
      for (const m of mutations) {
        this._setAttr(m.attributeName!)
      }
    }).observe(this, { attributes: true })
    // 解析
    const resolve = (def: InnerComponentDef, isAsync = false) => {
      // 解析属性与样式
      const { props, styles } = def

      // cast Number-type props set before resolve
      let numberProps
      // 如果属性为真与不是数组
      if (props && !isArray(props)) {
        // 循环属笥
        for (const key in props) {
          // 获取值
          const opt = props[key]
          // 如果值是数字或都值类型是数字
          if (opt === Number || (opt && opt.type === Number)) {
            // 循环当前环境属性
            if (key in this._props) {
              // 指向转换后的数字
              this._props[key] = toNumber(this._props[key])
            }
            // 更新值指向
            ;(numberProps || (numberProps = Object.create(null)))[
              camelize(key)
            ] = true
          }
        }
      }
      // 数字属性更新指向
      this._numberProps = numberProps
      // 如果是异步
      if (isAsync) {
        // defining getter/setters on prototype
        // for sync defs, this already happened in the constructor
        // 解析属性
        this._resolveProps(def)
      }

      // apply CSS 应用样式
      this._applyStyles(styles)

      // initial render 更新
      this._update()
    }

    const asyncDef = (this._def as ComponentOptions).__asyncLoader
    if (asyncDef) {
      asyncDef().then(def => resolve(def, true))
    } else {
      resolve(this._def)
    }
  }
  // 解析属笥
  private _resolveProps(def: InnerComponentDef) {
    // 解构属性
    const { props } = def
    // 如果数性是数组
    const declaredPropKeys = isArray(props) ? props : Object.keys(props || {})

    // check if there are props set pre-upgrade or connect 循环键
    for (const key of Object.keys(this)) {
      // 如果第0个是_ 
      if (key[0] !== '_' && declaredPropKeys.includes(key)) {
        // 设置属性
        this._setProp(key, this[key as keyof this], true, false)
      }
    }

    // defining getter/setters on prototype 驼峰化值
    for (const key of declaredPropKeys.map(camelize)) {
      // 代理属性
      Object.defineProperty(this, key, {
        get() {
          return this._getProp(key)
        },
        set(val) {
          this._setProp(key, val)
        }
      })
    }
  }
  // 设置属性
  protected _setAttr(key: string) {
    // 获取属性值
    let value = this.getAttribute(key)
    // 驼峰化键
    const camelKey = camelize(key)
    // 如果数字属性 与值为真
    if (this._numberProps && this._numberProps[camelKey]) {
      // 将值数字化
      value = toNumber(value)
    }
    // 设置属性
    this._setProp(camelKey, value, false)
  }

  /**
   * @internal
   */
  // 获取属性
  protected _getProp(key: string) {
    return this._props[key]
  }

  /**
   * @internal
   */
  // 设置属性
  protected _setProp(
    key: string,
    val: any,
    shouldReflect = true,
    shouldUpdate = true
  ) {
    // 如果值不为属性中的值
    if (val !== this._props[key]) {
      // 将值更新指向
      this._props[key] = val
      // 如果应该更新与上下文对象为真
      if (shouldUpdate && this._instance) {
        // 调用更新
        this._update()
      }
      // reflect  应该反射
      if (shouldReflect) {
        // 如果值为真
        if (val === true) {
          // 设置属性
          this.setAttribute(hyphenate(key), '')
          // 如果值为字符串
        } else if (typeof val === 'string' || typeof val === 'number') {
          // 设置属性
          this.setAttribute(hyphenate(key), val + '')
        } else if (!val) {
          // 移除属性
          this.removeAttribute(hyphenate(key))
        }
      }
    }
  }
  // 更新
  private _update() {
    // 渲染创建的节点
    render(this._createVNode(), this.shadowRoot!)
  }
  // 创建节点
  private _createVNode(): VNode<any, any> {
    // 创建节点
    const vnode = createVNode(this._def, extend({}, this._props))
    // 如果没有上下文对象 当前作用域
    if (!this._instance) {
      // 节点的CE指向方法
      vnode.ce = instance => {
        // 更新上下文对象指向
        this._instance = instance
        // 更新是创建元素
        instance.isCE = true
        // HMR 如果是开发环境
        if (__DEV__) {
          // 重载元素
          instance.ceReload = newStyles => {
            // always reset styles
            if (this._styles) {
              this._styles.forEach(s => this.shadowRoot!.removeChild(s))
              this._styles.length = 0
            }
            this._applyStyles(newStyles)
            this._instance = null
            this._update()
          }
        }
        // 更新
        const dispatch = (event: string, args: any[]) => {
          // 更新事件
          this.dispatchEvent(
            new CustomEvent(event, {
              detail: args
            })
          )
        }

        // intercept emit 上下文对象中的emit事件
        instance.emit = (event: string, ...args: any[]) => {
          // dispatch both the raw and hyphenated versions of an event
          // to match Vue behavior 更新事件及参数
          dispatch(event, args)
          // 激活事件不等于事件时
          if (hyphenate(event) !== event) {
            // 更新激活的事件
            dispatch(hyphenate(event), args)
          }
        }

        // locate nearest Vue custom element parent for provide/inject
        let parent: Node | null = this
        // 进行深度归并
        while (
          (parent =
            parent && (parent.parentNode || (parent as ShadowRoot).host))
        ) {
          // 如果是VUE元素
          if (parent instanceof VueElement) {
            // 更新上下文对象的parent
            instance.parent = parent._instance
            // 更新注入
            instance.provides = parent._instance!.provides
            break
          }
        }
      }
    }
    // 返回节点
    return vnode
  }
  // 应用样式
  private _applyStyles(styles: string[] | undefined) {
    if (styles) {
      styles.forEach(css => {
        const s = document.createElement('style')
        s.textContent = css
        this.shadowRoot!.appendChild(s)
        // record for HMR
        if (__DEV__) {
          ;(this._styles || (this._styles = [])).push(s)
        }
      })
    }
  }
}
