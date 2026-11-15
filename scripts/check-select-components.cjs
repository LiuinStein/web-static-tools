const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function findViolations(code, filename) {
  const file = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations = [];
  const namespaces = new Set();
  const fail = (node, reason) => violations.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, reason });
  const selectModule = value => /^@alifd\/next\/(?:lib|es)\/select(?:\/|$)/.test(value);
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === 'select') {
      fail(node, '原生 <select> 只能在 components/Select 内实现，请使用通用 Select 组件。');
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const source = node.moduleSpecifier.text;
      if (selectModule(source)) fail(node, '不得直接导入 Fusion 下拉框，请使用 components/Select 的适配组件。');
      if (source === '@alifd/next') {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const item of bindings.elements) if ((item.propertyName || item.name).text === 'Select') fail(item, '不得直接导入 Fusion Select（含别名），请使用通用组件。');
        }
        if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      }
    }
    if (ts.isPropertyAccessExpression(node) && namespaces.has(node.expression.getText(file)) && node.name.text === 'Select') fail(node, '不得通过命名空间绕过通用 Select 组件。');
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(file);
      if ((callee === 'React.createElement' || callee === 'createElement') && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'select') fail(node, '不得通过 createElement 绕过通用 Select 组件。');
      if (callee === 'require' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const source = node.arguments[0].text;
        if (source === '@alifd/next' || selectModule(source)) fail(node, '业务代码使用静态导入与通用 Select 组件，不得通过 require 绕过检查。');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return violations;
}

function checkProject(root = path.resolve(__dirname, '..')) {
  const errors = [];
  function walk(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, item.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (relative === 'src/components/Select') continue;
      if (item.isDirectory()) walk(full);
      else if (/\.[jt]sx?$/.test(item.name)) {
        for (const issue of findViolations(fs.readFileSync(full, 'utf8'), full)) errors.push(`${relative}:${issue.line} ${issue.reason}`);
      }
    }
  }
  walk(path.join(root, 'src'));
  return errors;
}
if (require.main === module) {
  const errors = checkProject();
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('下拉框组件检查通过：业务代码统一使用 components/Select。');
}
module.exports = { findViolations, checkProject };
