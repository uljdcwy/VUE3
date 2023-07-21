import {
  Node,
  Identifier,
  BlockStatement,
  CallExpression,
  ObjectPattern,
  ArrayPattern,
  Program,
  VariableDeclarator,
  Expression,
  VariableDeclaration,
  ImportDeclaration,
  ImportSpecifier,
  ImportDefaultSpecifier,
  ImportNamespaceSpecifier
} from '@babel/types'
import MagicString, { SourceMap } from 'magic-string'
import { walk } from 'estree-walker'
import {
  extractIdentifiers,
  isFunctionType,
  isInDestructureAssignment,
  isReferencedIdentifier,
  isStaticProperty,
  walkFunctionParams
} from '@vue/compiler-core'
import { parse, ParserPlugin } from '@babel/parser'
import { hasOwn, isArray, isString, genPropsAccessExp } from '@vue/shared'

const CONVERT_SYMBOL = '$'
const ESCAPE_SYMBOL = '$$'
const IMPORT_SOURCE = 'vue/macros'
const shorthands = ['ref', 'computed', 'shallowRef', 'toRef', 'customRef']
const transformCheckRE = /[^\w]\$(?:\$|ref|computed|shallowRef)?\s*(\(|\<)/

/**
 * @deprecated will be removed in 3.4
 */
// 应该转换 判断src  是否应该转换
export function shouldTransform(src: string): boolean {
  return transformCheckRE.test(src)
}

interface Binding {
  isConst?: boolean
  isProp?: boolean
}
type Scope = Record<string, Binding | false>

export interface RefTransformOptions {
  filename?: string
  sourceMap?: boolean
  parserPlugins?: ParserPlugin[]
  importHelpersFrom?: string
}

export interface RefTransformResults {
  code: string
  map: SourceMap | null
  rootRefs: string[]
  importedHelpers: string[]
}

export interface ImportBinding {
  local: string
  imported: string
  source: string
  specifier: ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier
}

/**
 * @deprecated will be removed in 3.4
 */
// 转换
export function transform(
  src: string,
  {
    filename,
    sourceMap,
    parserPlugins,
    importHelpersFrom = 'vue'
  }: RefTransformOptions = {}
): RefTransformResults {
  const plugins: ParserPlugin[] = parserPlugins || []
  // 如果文件名为真
  if (filename) {
    // 如果文件名是以tsx 后缀 插件压入typescript
    if (/\.tsx?$/.test(filename)) {
      plugins.push('typescript')
    }
    // 如果文件名最后一位是x插件中压入jsx
    if (filename.endsWith('x')) {
      plugins.push('jsx')
    }
  }
  // 转换内容的 ast 对象
  const ast = parse(src, {
    sourceType: 'module',
    plugins
  });
  // 新建模术字符串
  const s = new MagicString(src)
  // 将ast程序再次转换
  const res = transformAST(ast.program, s, 0)

  // inject helper imports
  // 如果有注入辅助导入
  if (res.importedHelpers.length) {
    // 压入导入内容
    s.prepend(
      `import { ${res.importedHelpers
        .map(h => `${h} as _${h}`)
        .join(', ')} } from '${importHelpersFrom}'\n`
    )
  }
  // 返回AST入资源文件内容
  return {
    ...res,
    code: s.toString(),
    map: sourceMap
      ? s.generateMap({
          source: filename,
          hires: true,
          includeContent: true
        })
      : null
  }
}

/**
 * @deprecated will be removed in 3.4
 */
export function transformAST(
  ast: Program,
  s: MagicString,
  offset = 0,
  knownRefs?: string[],
  knownProps?: Record<
    string, // public prop key
    {
      local: string // local identifier, may be different
      default?: any
      isConst?: boolean
    }
  >
): {
  rootRefs: string[]
  importedHelpers: string[]
} {
  // 输入警告
  warnExperimental()
  // 使用导入初始化为对象
  const userImports: Record<string, ImportBinding> = Object.create(null)
  // 循环ast内容
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue
    // 导入描述
    walkImportDeclaration(node)
  }

  // macro import handling
  let convertSymbol: string | undefined
  let escapeSymbol: string | undefined;
  // 循环对象的值
  for (const { local, imported, source, specifier } of Object.values(
    userImports
  )) {
    if (source === IMPORT_SOURCE) {
      // 导入为小写，的Symbol对象
      if (imported === ESCAPE_SYMBOL) {
        escapeSymbol = local
        // 如果导入为全部导入的 Symbol
      } else if (imported === CONVERT_SYMBOL) {
        convertSymbol = local
        // 如果导入不为本地
      } else if (imported !== local) {
        error(
          `macro imports for ref-creating methods do not support aliasing.`,
          specifier
        )
      }
    }
  }

  // default symbol
  if (!convertSymbol && !userImports[CONVERT_SYMBOL]) {
    convertSymbol = CONVERT_SYMBOL
  }
  if (!escapeSymbol && !userImports[ESCAPE_SYMBOL]) {
    escapeSymbol = ESCAPE_SYMBOL
  }

  const importedHelpers = new Set<string>()
  const rootScope: Scope = {}
  const scopeStack: Scope[] = [rootScope]
  let currentScope: Scope = rootScope
  let escapeScope: CallExpression | undefined // inside $$()
  const excludedIds = new WeakSet<Identifier>()
  const parentStack: Node[] = []
  const propsLocalToPublicMap: Record<string, string> = Object.create(null)
  // 如果是导知的Refs 循环导知的Refs
  if (knownRefs) {
    for (const key of knownRefs) {
      rootScope[key] = {}
    }
  }
  // 如果已知属性为真
  if (knownProps) {
    // 循环已知性
    for (const key in knownProps) {
      const { local, isConst } = knownProps[key]
      rootScope[local] = {
        isProp: true,
        isConst: !!isConst
      }
      propsLocalToPublicMap[local] = key
    }
  }
  // 获取导入描述
  function walkImportDeclaration(node: ImportDeclaration) {
    const source = node.source.value
    if (source === IMPORT_SOURCE) {
      s.remove(node.start! + offset, node.end! + offset)
    }

    for (const specifier of node.specifiers) {
      const local = specifier.local.name
      const imported =
        (specifier.type === 'ImportSpecifier' &&
          specifier.imported.type === 'Identifier' &&
          specifier.imported.name) ||
        'default'
      userImports[local] = {
        source,
        local,
        imported,
        specifier
      }
    }
  }

  // 判断Ref 是创建的
  function isRefCreationCall(callee: string): string | false {
    if (!convertSymbol || currentScope[convertSymbol] !== undefined) {
      return false
    }
    if (callee === convertSymbol) {
      return convertSymbol
    }
    if (callee[0] === '$' && shorthands.includes(callee.slice(1))) {
      return callee
    }
    return false
  }
  // 错误抛出
  function error(msg: string, node: Node): never {
    const e = new Error(msg)
    ;(e as any).node = node
    throw e
  }
  // 辅助添加消息
  function helper(msg: string) {
    importedHelpers.add(msg)
    return `_${msg}`
  }
  // 注删绑定ID
  function registerBinding(id: Identifier, binding?: Binding) {
    excludedIds.add(id)
    if (currentScope) {
      currentScope[id.name] = binding ? binding : false
    } else {
      error(
        'registerBinding called without active scope, something is wrong.',
        id
      )
    }
  }
  // 注册Ref绑定
  const registerRefBinding = (id: Identifier, isConst = false) =>
    registerBinding(id, { isConst })

  let tempVarCount = 0
  // 获取模版声名
  function genTempVar() {
    return `__$temp_${++tempVarCount}`
  }
  // 对字符的源数据进行切割 
  function snip(node: Node) {
    return s.original.slice(node.start! + offset, node.end! + offset)
  }
  // 作用域范围
  function walkScope(node: Program | BlockStatement, isRoot = false) {
    for (const stmt of node.body) {
      if (stmt.type === 'VariableDeclaration') {
        walkVariableDeclaration(stmt, isRoot)
      } else if (
        stmt.type === 'FunctionDeclaration' ||
        stmt.type === 'ClassDeclaration'
      ) {
        if (stmt.declare || !stmt.id) continue
        registerBinding(stmt.id)
      } else if (
        (stmt.type === 'ForOfStatement' || stmt.type === 'ForInStatement') &&
        stmt.left.type === 'VariableDeclaration'
      ) {
        walkVariableDeclaration(stmt.left)
      } else if (
        stmt.type === 'ExportNamedDeclaration' &&
        stmt.declaration &&
        stmt.declaration.type === 'VariableDeclaration'
      ) {
        walkVariableDeclaration(stmt.declaration, isRoot)
      } else if (
        stmt.type === 'LabeledStatement' &&
        stmt.body.type === 'VariableDeclaration'
      ) {
        walkVariableDeclaration(stmt.body, isRoot)
      }
    }
  }
  // 循环变量声名
  function walkVariableDeclaration(stmt: VariableDeclaration, isRoot = false) {
    // 如果属性 declare 为真返回
    if (stmt.declare) {
      return
    }
    // 循环 stmt 声名
    for (const decl of stmt.declarations) {
      let refCall
      const isCall =
        decl.init &&
        decl.init.type === 'CallExpression' &&
        decl.init.callee.type === 'Identifier'
        // 如果是调用为认证 与是 参考创建调用
      if (
        isCall &&
        (refCall = isRefCreationCall((decl as any).init.callee.name))
      ) {
        // 调用流程参考声名
        processRefDeclaration(
          refCall,
          decl.id,
          decl.init as CallExpression,
          stmt.kind === 'const'
        )
      } else {
        const isProps =
          isRoot && isCall && (decl as any).init.callee.name === 'defineProps'
          // 循环提出来的标识符
        for (const id of extractIdentifiers(decl.id)) {
          if (isProps) {
            // for defineProps destructure, only exclude them since they
            // are already passed in as knownProps
            // 扩展中添加id
            excludedIds.add(id)
          } else {
            // 注册绑定ID
            registerBinding(id)
          }
        }
      }
    }
  }
  // 提取标识符函数
  function processRefDeclaration(
    method: string,
    id: VariableDeclarator['id'],
    call: CallExpression,
    isConst: boolean
  ) {
    // 扩展中压入函数名
    excludedIds.add(call.callee as Identifier)
    // 如果方法为 convertSymbol
    if (method === convertSymbol) {
      // $
      // remove macro
      // 字符中移除 开始到结束位置
      s.remove(call.callee.start! + offset, call.callee.end! + offset)
      if (id.type === 'Identifier') {
        // single variable
        registerRefBinding(id, isConst)
      } else if (id.type === 'ObjectPattern') {
        processRefObjectPattern(id, call, isConst)
      } else if (id.type === 'ArrayPattern') {
        processRefArrayPattern(id, call, isConst)
      }
    } else {
      // shorthands
      if (id.type === 'Identifier') {
        registerRefBinding(id, isConst)
        // replace call
        s.overwrite(
          call.start! + offset,
          call.start! + method.length + offset,
          helper(method.slice(1))
        )
      } else {
        error(`${method}() cannot be used with destructure patterns.`, call)
      }
    }
  }
  // 进程引用对象
  function processRefObjectPattern(
    pattern: ObjectPattern,
    call: CallExpression,
    isConst: boolean,
    tempVar?: string,
    path: PathSegment[] = []
  ) {
    // 如果模版声名为假
    if (!tempVar) {
      // 获取模版变化
      tempVar = genTempVar()
      // const { x } = $(useFoo()) --> const __$temp_1 = useFoo()
      // 字符串S结束写入开始到结束位置
      s.overwrite(pattern.start! + offset, pattern.end! + offset, tempVar)
    }

    let nameId: Identifier | undefined
    // 循环对象模式属性
    for (const p of pattern.properties) {
      let key: Expression | string | undefined
      let defaultValue: Expression | undefined
      // 如果属性类型为对象属笥
      if (p.type === 'ObjectProperty') {
        // 如键的开始位置等于值 的开始位置
        if (p.key.start! === p.value.start!) {
          // shorthand { foo }
          nameId = p.key as Identifier;
          // 如果属性值类型为认证
          if (p.value.type === 'Identifier') {
            // avoid shorthand value identifier from being processed
            // 扩展ID添加属性值
            excludedIds.add(p.value);
            // 
          } else if (
            p.value.type === 'AssignmentPattern' &&
            p.value.left.type === 'Identifier'
          ) {
            // { foo = 1 }
            // 扩展ID添加属笥值的left
            excludedIds.add(p.value.left)
            // 默认值为属性值的right
            defaultValue = p.value.right
          }
        } else {
          // 属性计算属性为真时
          key = p.computed ? (p.key as Expression) : (p.key as Identifier).name
          if (p.value.type === 'Identifier') {
            // { foo: bar }
            nameId = p.value
          } else if (p.value.type === 'ObjectPattern') {
            processRefObjectPattern(p.value, call, isConst, tempVar, [
              ...path,
              key
            ])
          } else if (p.value.type === 'ArrayPattern') {
            processRefArrayPattern(p.value, call, isConst, tempVar, [
              ...path,
              key
            ])
          } else if (p.value.type === 'AssignmentPattern') {
            if (p.value.left.type === 'Identifier') {
              // { foo: bar = 1 }
              nameId = p.value.left
              defaultValue = p.value.right
            } else if (p.value.left.type === 'ObjectPattern') {
              processRefObjectPattern(p.value.left, call, isConst, tempVar, [
                ...path,
                [key, p.value.right]
              ])
            } else if (p.value.left.type === 'ArrayPattern') {
              processRefArrayPattern(p.value.left, call, isConst, tempVar, [
                ...path,
                [key, p.value.right]
              ])
            } else {
              // MemberExpression case is not possible here, ignore
            }
          }
        }
      } else {
        // 抛出错误
        // rest element { ...foo }
        error(`reactivity destructure does not support rest elements.`, p)
      }
      // 如果名称ID为真
      if (nameId) {
        // 注册ref绑定
        registerRefBinding(nameId, isConst)
        // inject toRef() after original replaced pattern
        // 路径转字符
        const source = pathToString(tempVar, path);
        // 如果key是字符串
        const keyStr = isString(key)
          ? `'${key}'`
          : key
          ? snip(key)
          : `'${nameId.name}'`
        const defaultStr = defaultValue ? `, ${snip(defaultValue)}` : ``
        s.appendLeft(
          call.end! + offset,
          `,\n  ${nameId.name} = ${helper(
      
            'toRef'
          )}(${source}, ${keyStr}${defaultStr})`
        )
      }
    }
    // 字符中压入结束分号
    if (nameId) {
      s.appendLeft(call.end! + offset, ';')
    }
  }
  // 处理引用数组模式
  function processRefArrayPattern(
    pattern: ArrayPattern,
    call: CallExpression,
    isConst: boolean,
    tempVar?: string,
    path: PathSegment[] = []
  ) {
    // 如果没有模版声名获取模版声名并完成写入
    if (!tempVar) {
      // const [x] = $(useFoo()) --> const __$temp_1 = useFoo()
      tempVar = genTempVar()
      s.overwrite(pattern.start! + offset, pattern.end! + offset, tempVar)
    }

    let nameId: Identifier | undefined
    // 循环模式列表
    for (let i = 0; i < pattern.elements.length; i++) {
      // 获取元素
      const e = pattern.elements[i];
      // 如果元素为假跳过循环
      if (!e) continue
      let defaultValue: Expression | undefined
      // 如果元素类型为认证
      if (e.type === 'Identifier') {
        // [a] --> [__a]
        nameId = e;
        // 如果元素类型为 AssignmentPattern
      } else if (e.type === 'AssignmentPattern') {
        // [a = 1]
        nameId = e.left as Identifier
        defaultValue = e.right
        // 如果元素类型为RestElement 
      } else if (e.type === 'RestElement') {
        // [...a]
        // 抛出错误
        error(`reactivity destructure does not support rest elements.`, e)
      } else if (e.type === 'ObjectPattern') {
        // 进程对象模式
        processRefObjectPattern(e, call, isConst, tempVar, [...path, i])
      } else if (e.type === 'ArrayPattern') {
        // 进程数组模式
        processRefArrayPattern(e, call, isConst, tempVar, [...path, i])
      }
      // 如果名称ID为真注册绑定名称ID
      if (nameId) {
        registerRefBinding(nameId, isConst)
        // inject toRef() after original replaced pattern
        const source = pathToString(tempVar, path)
        const defaultStr = defaultValue ? `, ${snip(defaultValue)}` : ``
        s.appendLeft(
          call.end! + offset,
          `,\n  ${nameId.name} = ${helper(
            'toRef'
          )}(${source}, ${i}${defaultStr})`
        )
      }
    }
    // 添加结尾分号
    if (nameId) {
      s.appendLeft(call.end! + offset, ';')
    }
  }

  type PathSegmentAtom = Expression | string | number

  type PathSegment =
    | PathSegmentAtom
    | [PathSegmentAtom, Expression /* default value */]
  // 字符串化路径
  function pathToString(source: string, path: PathSegment[]): string {
    // 如果路径为真
    if (path.length) {
      // 循环路径
      for (const seg of path) {
        // 拼接到资源
        if (isArray(seg)) {
          source = `(${source}${segToString(seg[0])} || ${snip(seg[1])})`
        } else {
          source += segToString(seg)
        }
      }
    }
    // 返回
    return source
  }
  // 段转字符串 返回 转段的字符串
  function segToString(seg: PathSegmentAtom): string {
    if (typeof seg === 'number') {
      return `[${seg}]`
    } else if (typeof seg === 'string') {
      return `.${seg}`
    } else {
      return snip(seg)
    }
  }
  // 重写id
  function rewriteId(
    scope: Scope,
    id: Identifier,
    parent: Node,
    parentStack: Node[]
  ): boolean {
    // 如果有私有作用域
    if (hasOwn(scope, id.name)) {
      // 获取作用域绑定
      const binding = scope[id.name]
      // 如果绑定为真
      if (binding) {
        // 如果绑定是const 与特定条件满足抛出错误
        if (
          binding.isConst &&
          ((parent.type === 'AssignmentExpression' && id === parent.left) ||
            parent.type === 'UpdateExpression')
        ) {
          error(`Assignment to constant variable.`, id)
        }
        // 在绑定中解构出属性
        const { isProp } = binding
        // 如果是静 态属性 与parent 速记为真
        if (isStaticProperty(parent) && parent.shorthand) {
          // let binding used in a property shorthand
          // skip for destructure patterns
          // 如果parent在模式为假者处理解构赋值中 
          if (
            !(parent as any).inPattern ||
            isInDestructureAssignment(parent, parentStack)
          ) {
            // 如果是属性
            if (isProp) {
              // 转换作用域
              if (escapeScope) {
                // prop binding in $$()
                // { prop } -> { prop: __props_prop }
                // 注册转换属性绑定
                registerEscapedPropBinding(id)
                s.appendLeft(
                  id.end! + offset,
                  `: __props_${propsLocalToPublicMap[id.name]}`
                )
              } else {
                // { prop } -> { prop: __props.prop }
                s.appendLeft(
                  id.end! + offset,
                  `: ${genPropsAccessExp(propsLocalToPublicMap[id.name])}`
                )
              }
            } else {
              // { foo } -> { foo: foo.value }
              s.appendLeft(id.end! + offset, `: ${id.name}.value`)
            }
          }
        } else {
          if (isProp) {
            if (escapeScope) {
              // x --> __props_x
              registerEscapedPropBinding(id)
              s.overwrite(
                id.start! + offset,
                id.end! + offset,
                `__props_${propsLocalToPublicMap[id.name]}`
              )
            } else {
              // x --> __props.x
              s.overwrite(
                id.start! + offset,
                id.end! + offset,
                genPropsAccessExp(propsLocalToPublicMap[id.name])
              )
            }
          } else {
            // x --> x.value
            s.appendLeft(id.end! + offset, '.value')
          }
        }
      }
      return true
    }
    return false
  }

  const propBindingRefs: Record<string, true> = {}
  // 注册转换属性绑定
  function registerEscapedPropBinding(id: Identifier) {
    // 如果属性绑定Refs有私有属性
    if (!propBindingRefs.hasOwnProperty(id.name)) {
      propBindingRefs[id.name] = true
      // 获取私有key
      const publicKey = propsLocalToPublicMap[id.name]
      s.prependRight(
        offset,
        `const __props_${publicKey} = ${helper(
          `toRef`
        )}(__props, '${publicKey}');\n`
      )
    }
  }

  // check root scope first
  // 检查根作用域
  walkScope(ast, true);
  // walk 函数执行
  walk(ast, {
    enter(node: Node, parent?: Node) {
      // parent任务中压入parent
      parent && parentStack.push(parent)

      // function scopes
      // 如果节点是函数类型
      if (isFunctionType(node)) {
        // 作用域任务中压入当前作用域
        scopeStack.push((currentScope = {}))
        // 漫步函数参数 传入节点与注册绑定
        walkFunctionParams(node, registerBinding)
        // 如果节点内容类型为  块声名
        if (node.body.type === 'BlockStatement') {
          // 漫步作用域
          walkScope(node.body)
        }
        return
      }

      // catch param
      // 如果节点类型为捕获错误
      if (node.type === 'CatchClause') {
        // 作用域任务压入当前作用鞋号
        scopeStack.push((currentScope = {}))
        // 如果节点参数与节点参数类型为 Identifier
        if (node.param && node.param.type === 'Identifier') {
          // 注册绑定
          registerBinding(node.param)
        }
        // 漫步作用域
        walkScope(node.body)
        return
      }

      // non-function block scopes
      // 如果节点类型为块语句 与不是函数类型
      if (node.type === 'BlockStatement' && !isFunctionType(parent!)) {
        // 作用域任务压入当前作用域
        scopeStack.push((currentScope = {}))
        // 漫步作用域传入节点
        walkScope(node)
        return
      }

      // skip type nodes
      if (
        parent &&
        parent.type.startsWith('TS') &&
        parent.type !== 'TSAsExpression' &&
        parent.type !== 'TSNonNullExpression' &&
        parent.type !== 'TSTypeAssertion'
      ) {
        return this.skip()
      }
      // 如果节点类型为ID认证
      if (node.type === 'Identifier') {
        const binding = rootScope[node.name]
        // 
        if (
          // if inside $$(), skip unless this is a destructured prop binding
          !(escapeScope && (!binding || !binding.isProp)) &&
          isReferencedIdentifier(node, parent!, parentStack) &&
          !excludedIds.has(node)
        ) {
          // walk up the scope chain to check if id should be appended .value
          let i = scopeStack.length
          // 循环作用域任务列表
          while (i--) {
            // 写入ID
            if (rewriteId(scopeStack[i], node, parent!, parentStack)) {
              return
            }
          }
        }
      }
      // 发果节点类型为  CallExpression 与节点callee类型为 Identifier
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
        const callee = node.callee.name
        // 如果是Ref创建Call
        const refCall = isRefCreationCall(callee)
        // 如果refCall 与 parent为假或者parent.type不为VariableDeclarator  抛出错误
        if (refCall && (!parent || parent.type !== 'VariableDeclarator')) {
          return error(
            `${refCall} can only be used as the initializer of ` +
              `a variable declaration.`,
            node
          )
        }

        if (
          escapeSymbol &&
          currentScope[escapeSymbol] === undefined &&
          callee === escapeSymbol
        ) {
          escapeScope = node
          s.remove(node.callee.start! + offset, node.callee.end! + offset)
          // 如果parent的类型为 表达式语句
          if (parent?.type === 'ExpressionStatement') {
            // edge case where the call expression is an expression statement
            // if its own - prepend semicolon to avoid it being parsed as
            // function invocation of previous line
            let i =
              (node.leadingComments
                ? node.leadingComments[0].start
                : node.start)! + offset
            while (i--) {
              // 获取第I个字符的编码
              const char = s.original.charAt(i)
              if (char === '\n') {
                // only insert semi if it's actually the first thing after
                // newline
                s.prependRight(node.start! + offset, ';')
                break
              } else if (!/\s/.test(char)) {
                break
              }
            }
          }
        }
      }
    },
    // 
    leave(node: Node, parent?: Node) {
      // parent任务中弹栈头
      parent && parentStack.pop()
      // 如果节点类型为声语句与parent不是函数类型或者节点是函数类型
      if (
        (node.type === 'BlockStatement' && !isFunctionType(parent!)) ||
        isFunctionType(node)
      ) {
        // 作用域任务弹栈头
        scopeStack.pop()
        currentScope = scopeStack[scopeStack.length - 1] || null
      }
      // 如果节点指向转换作用域
      if (node === escapeScope) {
        escapeScope = undefined
      }
    }
  })
  // 返回根Refs以入导入辅助
  return {
    rootRefs: Object.keys(rootScope).filter(key => {
      const binding = rootScope[key]
      return binding && !binding.isProp
    }),
    importedHelpers: [...importedHelpers]
  }
}

const hasWarned: Record<string, boolean> = {}
// 实验性功能警告
function warnExperimental() {
  // eslint-disable-next-line
  if (typeof window !== 'undefined') {
    return
  }
  warnOnce(
    `Reactivity Transform was an experimental feature and has now been deprecated. ` +
      `It will be removed from Vue core in 3.4. If you intend to continue using it, ` +
      `switch to https://vue-macros.sxzz.moe/features/reactivity-transform.html.\n` +
      `See reason for deprecation here: https://github.com/vuejs/rfcs/discussions/369#discussioncomment-5059028`
  )
}
// 只输出一次消息
function warnOnce(msg: string) {
  const isNodeProd =
    typeof process !== 'undefined' && process.env.NODE_ENV === 'production'
  if (!isNodeProd && !__TEST__ && !hasWarned[msg]) {
    hasWarned[msg] = true
    warn(msg)
  }
}
// 输入警告
function warn(msg: string) {
  console.warn(
    `\x1b[1m\x1b[33m[@vue/reactivity-transform]\x1b[0m\x1b[33m ${msg}\x1b[0m\n`
  )
}
