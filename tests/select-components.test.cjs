const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findViolations, checkProject } = require('../scripts/check-select-components.cjs');
const check = code => findViolations(code, 'Feature.tsx');

test('allows shared components, option groups, callbacks and layout props', () => {
  assert.deepEqual(check(`import Select, { CompactSelect, SelectAutoComplete } from '@/components/Select';
  const form = <Select disabled={busy} onChange={e => update(e.target.value)}><optgroup label="分组"><option value="x">选项</option></optgroup></Select>;
  const input = <SelectAutoComplete style={{ width: '100%' }} />;`), []);
});
test('blocks native selects and aliases of Fusion Select', () => {
  for (const code of ['const x = <select />;', 'const x = <select><option>x</option></select>;',
    `import { Select as Other } from '@alifd/next';`, `import Other from '@alifd/next/lib/select';`,
    `import * as Next from '@alifd/next'; const x = <Next.Select />;`,
    `const x = React.createElement('select', {});`, `const { Select } = require('@alifd/next');`]) {
    assert.ok(check(code).length, code);
  }
});
test('does not reject non-select imports, strings or comments', () => {
  assert.deepEqual(check(`import { Input, Card } from '@alifd/next'; const s = '<select>'; // <select />`), []);
});
test('all existing feature controls use the component boundary', () => {
  assert.deepEqual(checkProject(), []);
});

// Render the public component to verify its HTML contract without adding a DOM dependency.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function loadSelect() {
  const filename = path.resolve(__dirname, '../src/components/Select/index.tsx');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const cssLoader = require.extensions['.css'];
  require.extensions['.css'] = () => {};
  try {
    loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText, filename);
    return loaded.exports.default;
  } finally {
    if (cssLoader) require.extensions['.css'] = cssLoader;
    else delete require.extensions['.css'];
  }
}
const Select = loadSelect();
const option = (value, label) => React.createElement('option', { value, key: value }, label);
test('preserves form attributes, grouped options and controlled selection', () => {
  const html = renderToStaticMarkup(React.createElement(Select, {
    id: 'broker', name: 'broker', form: 'trade', required: true, disabled: true,
    'aria-label': '券商', value: 'b', onChange() {},
  }, React.createElement('optgroup', { label: '港股' }, [option('a', '甲'), option('b', '乙')])));
  for (const attribute of ['id="broker"', 'name="broker"', 'form="trade"', 'required=""', 'disabled=""', 'aria-label="券商"', '<optgroup label="港股">']) assert.ok(html.includes(attribute), attribute);
  const selected = html.match(/<option([^>]+)>乙<\/option>/);
  assert.ok(selected && selected[1].includes('value="b"') && selected[1].includes('selected=""'));
});
test('locks 12px arrow inset and 36px text reserve while allowing layout sizing', () => {
  const html = renderToStaticMarkup(React.createElement(Select, {
    style: { width: 200, appearance: 'auto', paddingRight: 0, backgroundImage: 'none' },
    defaultValue: 'a',
  }, option('a', '选项')));
  for (const style of ['width:200px', 'appearance:none', 'background-position:right 12px center', 'padding-right:36px', 'background-image:url(']) assert.ok(html.includes(style), style);
  assert.ok(!html.includes('appearance:auto'));
});
test('keeps multi-select and listbox semantics without a dropdown arrow', () => {
  const html = renderToStaticMarkup(React.createElement(Select, { multiple: true, size: 3, defaultValue: ['a', 'b'] }, [option('a', '甲'), option('b', '乙')]));
  assert.ok(html.includes('multiple=""'));
  assert.ok(html.includes('size="3"'));
  assert.equal((html.match(/selected=""/g) || []).length, 2);
  assert.ok(!html.includes('background-image'));
});
