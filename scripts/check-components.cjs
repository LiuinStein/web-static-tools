const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const postcss = require('postcss');
const rules = require('./component-rules.cjs');
const root = path.resolve(__dirname, '..');
const layoutKeys = new Set(['width', 'minWidth', 'maxWidth', 'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'display', 'flex', 'flexGrow', 'flexShrink', 'alignSelf', 'gridColumn']);
const slash = value => value.split(path.sep).join('/');
const relative = filename => slash(path.isAbsolute(filename) ? path.relative(root, filename) : filename);
const canonical = value => value.replace(/\.(?:[jt]sx?)$/, '').replace(/\/index$/, '');
const owns = (rule, file) => rule.owners.includes(relative(file));
function localPath(source, file) {
  if (source.startsWith('@/')) return path.posix.normalize('src/' + source.slice(2));
  if (source.startsWith('.')) return path.posix.normalize(path.posix.join(path.posix.dirname(relative(file)), source));
  return source;
}
function sharedRule(source, file) {
  const target = canonical(localPath(source, file));
  return rules.find(r => [r.entry, ...(r.aliases || [])].some(entry => canonical(entry) === target));
}
function libraryRule(source, name) {
  return rules.find(r => r.library && ((source === '@alifd/next' && name === r.library) || new RegExp(`^@alifd/next/(?:lib|es)/${r.subpath}(?:/|$)`).test(source)));
}
function privateStyle(source, file) {
  const target = localPath(source, file);
  return rules.find(r => !rules.some(x => x.publicStyles && x.styles.includes(target)) && !r.publicStyles && r.styles.includes(target) && !r.owners.includes(relative(file)) && !r.styles.includes(relative(file)));
}
function findCodeViolations(code, filename = 'Feature.tsx', usageClasses) {
  const sf = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(filename) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const errors = [], bindings = new Map(), constants = new Map(), namespaces = new Set(), reactElements = new Set(['React.createElement', 'createElement']);
  const fail = (node, rule, message) => errors.push({ rule: rule.id || rule, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, reason: message });
  function each(node, fn) { fn(node); ts.forEachChild(node, child => each(child, fn)); }
  // Collect imports first so namespace/alias checks do not depend on declaration order.
  each(sf, node => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) {
      let scope = node.parent;
      while (scope && !ts.isBlock(scope) && !ts.isSourceFile(scope) && !ts.isFunctionLike(scope)) scope = scope.parent;
      const constant = ts.isVariableDeclaration(node) && Boolean(node.parent.flags & ts.NodeFlags.Const);
      const entries = constants.get(node.name.text) || [];
      entries.push({ scope: scope || sf, value: constant ? node.initializer : undefined });
      constants.set(node.name.text, entries);
    }
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.importClause?.isTypeOnly) return;
    const source = node.moduleSpecifier.text, clause = node.importClause, named = clause?.namedBindings, shared = sharedRule(source, filename);
    if (clause?.name && shared) bindings.set(clause.name.text, shared);
    if (named && ts.isNamespaceImport(named)) {
      if (source === '@alifd/next') namespaces.add(named.name.text);
      if (shared) for (const exported of ['default', 'CompactSelect', 'SelectAutoComplete']) bindings.set(named.name.text + '.' + exported, shared);
    }
    if (named && ts.isNamedImports(named)) for (const item of named.elements) {
      if (item.isTypeOnly) continue;
      const original = (item.propertyName || item.name).text;
      if (shared) bindings.set(item.name.text, shared);
      if (source === 'react' && original === 'createElement') reactElements.add(item.name.text);
    }
  });
  function unwrap(n) {
    while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isTypeAssertionExpression(n) || ts.isSatisfiesExpression(n))) n = n.expression;
    return n;
  }
  function constantValue(node) {
    const candidates = (constants.get(node.text) || []).filter(x => x.scope.pos <= node.pos && node.end <= x.scope.end);
    candidates.sort((a, b) => (a.scope.end - a.scope.pos) - (b.scope.end - b.scope.pos));
    return candidates[0]?.value;
  }
  function resolve(n, seen = new Set()) {
    n = unwrap(n);
    if (n && ts.isIdentifier(n) && constantValue(n) && !seen.has(n)) { seen.add(n); return resolve(constantValue(n), seen); }
    return n;
  }
  function values(n, seen = new Set()) {
    n = unwrap(n);
    if (!n) return [];
    if (ts.isStringLiteralLike(n)) return [n.text];
    if (ts.isIdentifier(n) && constantValue(n) && !seen.has(n)) { seen.add(n); return values(constantValue(n), seen); }
    if (ts.isConditionalExpression(n)) return [...values(n.whenTrue, new Set(seen)), ...values(n.whenFalse, new Set(seen))];
    return [null];
  }
  function objectMembers(n, seen = new Set()) {
    n = resolve(n, seen);
    if (!n || (ts.isIdentifier(n) && n.text === 'undefined')) return [];
    if (ts.isConditionalExpression(n)) return [...objectMembers(n.whenTrue, new Set(seen)), ...objectMembers(n.whenFalse, new Set(seen))];
    if (!ts.isObjectLiteralExpression(n)) return [null];
    return n.properties.flatMap(prop => {
      if (ts.isSpreadAssignment(prop)) return objectMembers(prop.expression, new Set(seen));
      if (prop.name) {
        const name = ts.isComputedPropertyName(prop.name) ? values(prop.name.expression)[0] : prop.name.text;
        if (typeof name === 'string') return [{ name, value: prop.initializer, node: prop }];
      }
      return [null];
    });
  }
  function jsxProps(node) {
    const result = new Map();
    for (const attr of node.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attr)) {
        for (const prop of objectMembers(attr.expression)) {
          if (prop) { result.set(prop.name, { value: prop.value, node: prop.node }); if (prop.name === 'type') result.delete('__unknownType'); }
          else result.set('__unknownType', { node: attr });
        }
      } else {
        result.set(attr.name.text, { value: attr.initializer && (ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : attr.initializer), node: attr });
        if (attr.name.text === 'type') result.delete('__unknownType');
      }
    }
    return result;
  }
  function inspectNative(node, tag, props) {
    const rule = rules.find(r => r.native === (tag === 'input' ? 'date' : tag === 'button' ? 'pressed-button' : tag));
    if (!rule || owns(rule, filename)) return;
    if (tag === 'input') {
      if (props.has('__unknownType')) { fail(node, rule, 'input 的动态展开可能覆盖 type；请在展开后明确指定非日期类型，日期使用 DateInput。'); return; }
      if (!props.has('type')) return;
      const types = values(props.get('type').value);
      if (types.includes('date')) fail(props.get('type').node, rule, '原生日期输入必须复用 DateInput。');
      else if (types.includes(null)) fail(node, rule, '无法确定动态 input type；请将日期分支改用 DateInput，其余分支使用明确类型。');
    } else if (tag !== 'button' || props.has('aria-pressed')) fail(node, rule, tag === 'button' ? '有选择状态的按钮统一复用 SegmentedControl，不在页面重写分段选项。' : `原生 <${tag}> 必须通过 ${rule.component} 实现。`);
  }
  function inspectProps(node, rule, props) {
    if (owns(rule, filename)) return;
    for (const name of rule.managedProps || []) if (props.has(name)) fail(props.get(name).node, rule, `${rule.component} 的 ${name} 由公共组件维护，不能在业务侧覆盖。`);
    for (const [name, allowed] of Object.entries(rule.enumProps || {})) if (props.has(name)) {
      for (const value of values(props.get(name).value)) if (value !== null && !allowed.includes(value)) fail(props.get(name).node, rule, `${rule.component} 的 ${name} 只支持 ${allowed.join(', ')}。`);
    }
    if (rule.layoutStyle && props.has('style')) for (const prop of objectMembers(props.get('style').value)) {
      if (!prop || !layoutKeys.has(prop.name)) fail(prop?.node || props.get('style').node, rule, '下拉组件 style 只允许明确的布局属性，禁止覆盖箭头与留白。');
    }
  }
  function inspectImport(node, source, names = []) {
    const privateRule = privateStyle(source, filename);
    if (privateRule) fail(node, privateRule, `不得直接导入 ${privateRule.component} 的私有样式。`);
    const direct = libraryRule(source);
    if (direct && !owns(direct, filename)) fail(node, direct, `不得从组件库子路径绕过 ${direct.component}。`);
    for (const name of names) {
      const rule = libraryRule(source, name);
      if (rule && !owns(rule, filename)) fail(node, rule, `不得直接导入组件库 ${name}（包括别名），请复用 ${rule.component}。`);
    }
  }
  function locallyBound(name, node) {
    for (let scope = node.parent; scope; scope = scope.parent) {
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope) && !ts.isFunctionLike(scope)) continue;
      let found = false;
      function names(n) { if (ts.isIdentifier(n) && n.text === name) found = true; else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) for (const e of n.elements) if (ts.isBindingElement(e)) names(e.name); }
      function scan(n) {
        if (n !== scope && (ts.isFunctionLike(n) || ts.isBlock(n))) { if (n.name) names(n.name); return; }
        if (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isImportClause(n) || ts.isImportSpecifier(n)) if (n.name) names(n.name);
        ts.forEachChild(n, scan);
      }
      scan(scope); if (found) return true;
    }
    return false;
  }
  each(sf, node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (node.isTypeOnly || node.importClause?.isTypeOnly) return;
      const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
      const names = bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) ? bindings.elements.filter(x => !x.isTypeOnly).map(x => (x.propertyName || x.name).text) : [];
      inspectImport(node, node.moduleSpecifier.text, names);
      if (ts.isExportDeclaration(node) && !node.exportClause && node.moduleSpecifier.text === '@alifd/next') fail(node, 'library-import', '不得重新导出整个组件库来绕过共享组件。');
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const object = node.expression.getText(sf), member = ts.isPropertyAccessExpression(node) ? node.name.text : values(node.argumentExpression)[0];
      const rule = namespaces.has(object) && libraryRule('@alifd/next', member);
      if (rule && !owns(rule, filename)) fail(node, rule, '不得通过组件库命名空间绕过共享组件。');
      if (namespaces.has(object) && member === null) fail(node, 'library-import', '不能动态访问组件库命名空间中的未知控件。');
      if (['window', 'globalThis', 'self'].includes(object) && member === 'confirm') fail(node, 'confirmation', '浏览器 confirm 必须替换为 useToolConfirm。');
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf), props = jsxProps(node);
      inspectNative(node, tag, props);
      const rule = bindings.get(tag);
      if (rule) inspectProps(node, rule, props);
      const classes = props.has('className') ? values(props.get('className').value).filter(Boolean).flatMap(x => x.split(/\s+/)) : [];
      if (rule && usageClasses) for (const name of classes) if (!usageClasses.has(name)) usageClasses.set(name, rule);
      for (const r of rules) if (r.markupClasses?.some(c => classes.includes(c)) && !owns(r, filename)) fail(node, r, `请复用 ${r.component}，不要复制其结构类名。`);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf), first = node.arguments[0];
      if (callee === 'confirm' && !locallyBound('confirm', node)) fail(node, 'confirmation', '原生 confirm 必须替换为 useToolConfirm。');
      if (reactElements.has(callee) && first) {
        const props = new Map();
        for (const x of objectMembers(node.arguments[1])) {
          if (x) { props.set(x.name, { value: x.value, node: x.node }); if (x.name === 'type') props.delete('__unknownType'); }
          else props.set('__unknownType', { node });
        }
        const tag = ts.isStringLiteralLike(first) ? first.text : null;
        if (tag) inspectNative(node, tag, props);
        const component = bindings.get(first.getText(sf));
        if (component) inspectProps(node, component, props);
      }
      if ((callee === 'require' || node.expression.kind === ts.SyntaxKind.ImportKeyword) && first && ts.isStringLiteral(first)) {
        inspectImport(node, first.text);
        if (first.text === '@alifd/next') fail(node, 'library-import', '组件库使用静态命名导入，不能通过 require 或动态导入绕过规则。');
      }
    }
  });
  return errors;
}
function findStyleViolations(code, filename, usageClasses = new Map()) {
  const errors = [], file = relative(filename);
  const fail = (node, rule, reason) => errors.push({ rule: rule.id || rule, line: node.source?.start?.line || 1, reason });
  let css;
  try { css = postcss.parse(code, { from: filename }); } catch (error) { return [{ rule: 'css-syntax', line: error.line || 1, reason: error.reason }]; }
  css.walkAtRules('import', node => {
    const source = node.params.match(/^(?:url\(\s*)?["']([^"']+)["']/)?.[1];
    const rule = source && privateStyle(source, filename);
    if (rule) fail(node, rule, `不能导入 ${rule.component} 的私有样式。`);
  });
  css.walkRules(node => {
    for (const rule of rules) {
      if (rule.styles.includes(file)) continue;
      if (rule.classes?.some(c => new RegExp('\\.' + c + '(?:[\\w-]*)(?![\\w-])').test(node.selector))) {
        const reason = `${rule.component} 的内部选择器由组件样式维护，页面只能定义自身布局类。`;
        fail(node, rule, reason); node.walkDecls(decl => fail(decl, rule, reason));
      }
    }
    for (const [name, rule] of usageClasses) {
      if (rule.styles.includes(file)) continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp('\\.' + escaped + '(?![\\w-])').exec(node.selector);
      if (!match) continue;
      const tail = node.selector.slice(match.index + match[0].length).split(',')[0].trim();
      if (tail && rule.contentContainer) continue; // Dialog children are public business content slots.
      const layout = new Set(['width', 'min-width', 'max-width', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'display', 'flex', 'flex-grow', 'flex-shrink', 'align-self', 'grid-column']);
      node.walkDecls(decl => {
        if (tail || !layout.has(decl.prop)) fail(decl, rule, `${rule.component} 的业务类 ${name} 只能用于外部布局，不得覆盖内部结构、状态或几何。`);
      });
    }
    const date = /::-(?:webkit-date-and-time-value|webkit-datetime-edit|webkit-calendar-picker-indicator)|input\s*\[\s*type\s*=\s*["']?date["']?\s*\]/.test(node.selector);
    const select = /(?:^|[\s,(>+~])select(?=$|[\s.#[:,)>+~])/.test(node.selector);
    const forbidden = /^(?:appearance|-webkit-appearance|background(?:-image|-position(?:-x|-y)?|-size|-repeat)?|padding(?:-right|-inline|-inline-end)?|height|line-height|transform)$/;
    node.walkDecls(decl => {
      for (const rule of rules) if (rule.variables?.includes(decl.prop) && !rule.styles.includes(file)) fail(decl, rule, `组件内部变量 ${decl.prop} 不得在业务样式中赋值。`);
      if (date && file !== 'src/components/DateInput/style.css' && forbidden.test(decl.prop)) fail(decl, 'date-input', '日期几何及原生伪元素样式必须在 DateInput 内维护。');
      if (select && file !== 'src/components/Select/style.css' && /^(?:appearance|-webkit-appearance|background(?:-image|-position(?:-x|-y)?|-size|-repeat)?|padding(?:-right|-inline|-inline-end)?)$/.test(decl.prop)) fail(decl, 'select', '原生选择框箭头及留白只能在 Select 内维护；通用输入样式请拆分。');
    });
  });
  return errors;
}
// Git defines new code: added/replacement lines plus every line in untracked files.
function changedLines(projectRoot, base = 'HEAD') {
  const git = args => execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  git(['rev-parse', '--verify', base + '^{commit}']);
  const changed = new Map();
  const files = git(['diff', '--name-only', '-z', '--no-renames', base, '--', 'src']).split('\0').filter(Boolean);
  for (const file of files) {
    const lines = new Set();
    const diff = git(['diff', '--unified=0', '--no-ext-diff', '--no-textconv', '--no-renames', base, '--', file]);
    for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
      const start = Number(match[1]), count = match[2] === undefined ? 1 : Number(match[2]);
      for (let line = start; line < start + count; line++) lines.add(line);
    }
    if (lines.size) changed.set(file, lines);
  }
  for (const file of git(['ls-files', '--others', '--exclude-standard', '-z', '--', 'src']).split('\0').filter(Boolean)) changed.set(file, null);
  return changed;
}
function checkProject(projectRoot = root, { base = process.env.COMPONENT_CHECK_BASE || 'HEAD' } = {}) {
  const changed = changedLines(projectRoot, base), errors = [], usages = new Map();
  const append = (file, issues) => {
    const lines = changed.get(file);
    for (const issue of issues) if (lines === null || lines?.has(issue.line)) errors.push(`${file}:${issue.line} [${issue.rule}] ${issue.reason}`);
  };
  // Existing JSX supplies class/import context for changed CSS; historical findings are discarded.
  function context(dir) {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name), file = slash(path.relative(projectRoot, full));
      if (item.isDirectory()) context(full);
      else if (/\.[jt]sx?$/.test(file)) {
        const issues = findCodeViolations(fs.readFileSync(full, 'utf8'), file, usages);
        if (changed.has(file)) append(file, issues);
      }
    }
  }
  context(path.join(projectRoot, 'src'));
  for (const [file] of changed) if (/\.css$/.test(file) && fs.existsSync(path.join(projectRoot, file))) append(file, findStyleViolations(fs.readFileSync(path.join(projectRoot, file), 'utf8'), file, usages));
  return [...new Set(errors)];
}
function main(projectRoot = root) {
  if (process.argv.includes('--list')) { for (const rule of rules) console.log(`${rule.id}: ${rule.component}\n  入口: ${rule.entry}\n  边界: ${rule.review}`); return; }
  const index = process.argv.indexOf('--base');
  if (index !== -1 && !process.argv[index + 1]) { console.error('--base 需要指定 Git 提交或分支。'); process.exitCode = 1; return; }
  let errors;
  try { errors = checkProject(projectRoot, { base: index === -1 ? undefined : process.argv[index + 1] }); }
  catch (error) { console.error('无法确定新增代码范围，请确认 Git 仓库及 --base 引用有效。'); process.exitCode = 1; return; }
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`组件规范检查通过：${rules.length} 类共享组件/模板，未发现新增违规。`);
}
if (require.main === module) main();
module.exports = { rules, findCodeViolations, findStyleViolations, checkProject, changedLines, main };
