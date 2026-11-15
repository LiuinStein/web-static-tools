const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const git = (directory, ...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
function snapshot(directory) {
  git(directory, 'init', '-q'); git(directory, 'add', '.');
  git(directory, '-c', 'user.name=Component Test', '-c', 'user.email=component-test@example.invalid', 'commit', '-qm', 'existing source');
  return git(directory, 'rev-parse', 'HEAD');
}
const { rules, findCodeViolations: code, findStyleViolations: css, checkProject } = require('../scripts/check-components.cjs');
const file = 'src/pages/Example/index.tsx';
const check = text => code(text, file);
const blocked = (text, id) => assert.ok(check(text).some(issue => issue.rule === id), text);
const clean = text => assert.deepEqual(check(text), [], text);

test('registry covers every shared family, without exempting whole feature pages', () => {
  assert.deepEqual(rules.map(x => x.id), ['sortable-header', 'select', 'date-input', 'segmented', 'dialog', 'confirmation', 'page-header', 'tool-template', 'financial-template', 'comparison-table']);
  for (const rule of rules) {
    assert.ok(rule.entry && rule.review);
    assert.ok(fs.readFileSync(path.resolve(__dirname, '../docs/CODING_GUIDELINES.md'), 'utf8').includes('`' + rule.id + '`'), rule.id);
    assert.ok(rule.owners.every(owner => owner.startsWith('src/components/')));
    assert.ok(rule.owners.length || rule.styles.length);
  }
  assert.deepEqual(checkProject(), []);
});
test('normal composition retains labels, options, native non-date inputs and range widgets', () => {
  clean(`import Select from '@/components/Select'; import DateInput from '@/components/DateInput';
    import Segments from '@/components/SegmentedControl'; import Dialog from '@/components/ToolPage/ToolDialog';
    import Header from '@/components/PageHeader'; import { DatePicker, Input, Card } from '@alifd/next';
    const ui = <><Header title="页面" /><Select onChange={e => update(e.target.value)}><optgroup label="组"><option>项</option></optgroup></Select>
    <DateInput required min="2026-01-01" density="regular" /><Segments value="a" options={options} onChange={update} aria-label="模式" />
    <Dialog visible><div className="business-content" /></Dialog><DatePicker.RangePicker /><input type="text" /><input type="radio" /><textarea /></>;`);
});
test('native select and library aliases/subpaths/reexports cannot bypass ownership', () => {
  for (const text of [`const ui = <select />;`, `import { Select as Private } from '@alifd/next';`,
    `import S from '@alifd/next/es/select';`, `export { Select as Private } from '@alifd/next';`,
    `import * as Next from '@alifd/next'; const ui = <Next.Select />;`,
    `import * as Next from '@alifd/next'; const S = Next['Select'];`, `const ui = React.createElement('select');`]) blocked(text, 'select');
  assert.ok(code('const ui=<select/>;', 'src/components/Select/Copied.tsx').length);
  assert.deepEqual(code('const ui=<select/>;', 'src/components/Select/index.tsx'), []);
});
test('date literals, constants, conditional types and spreads require DateInput', () => {
  for (const text of [`const ui=<input type="date"/>;`, `const kind='date' as const; const ui=<input type={kind}/>;`,
    `const ui=<input type={condition ? 'date' : 'text'}/>;`, `const p={type:'date'}; const ui=<input {...p}/>;`,
    `const ui=React.createElement('input',{type:'date'});`, `function Field({type}){return <input type={type}/>;}`,
    `const ui=<input type="text" {...props}/>;`, `const ui=<input {...props}/>;`]) blocked(text, 'date-input');
  clean(`const ui=<input {...props} type="text"/>;`);
  clean(`const ui=<input type={condition ? 'number' : 'text'}/>;`);
  clean(`const kind='text'; const ui=<input type={kind}/>;`);
  blocked(`const kind='text'; function F(kind){return <input type={kind}/>;}`, 'date-input');
  clean(`const kind='date'; function F(){const kind='text';return <input type={kind}/>;}`);
});
test('native stateful buttons and native dialogs require shared components', () => {
  blocked(`const ui=<div role="group"><button aria-pressed={chosen}/></div>;`, 'segmented');
  blocked(`const ui=React.createElement('button',{'aria-pressed':true});`, 'segmented');
  clean(`const ui=<button onClick={save}>保存</button>;`);
  blocked(`const ui=<dialog/>;`, 'dialog');
  blocked(`import { Dialog as Popup } from '@alifd/next';`, 'dialog');
  blocked(`import Popup from '@alifd/next/lib/dialog';`, 'dialog');
  clean(`import type { Dialog } from '@alifd/next'; type P=React.ComponentProps<typeof Dialog>;`);
});
test('browser confirmations are rejected while hook/local callbacks remain valid', () => {
  for (const text of [`window.confirm('x');`, `globalThis['confirm']('x');`, `confirm('x');`,
    `function run(){confirm('x')} function other(){const confirm=custom;}`,
    `function run(){if(ok){const confirm=custom;}confirm('x');}`]) blocked(text, 'confirmation');
  clean(`function run(){const { confirm }=useToolConfirm();confirm({title:'保存'});}`);
  clean(`function run(confirm){confirm('x');}`);
});
test('component props are checked through aliases and constant style objects', () => {
  blocked(`import D from '@/components/DateInput'; const ui=<D style={{height:60}}/>;`, 'date-input');
  blocked(`import D from '@/components/DateInput'; const ui=<D density="custom"/>;`, 'date-input');
  blocked(`import S from '@/components/SegmentedControl'; const ui=<S variant="other"/>;`, 'segmented');
  blocked(`import D from '@/components/DateInput'; const p={['type']:'text'}; const ui=<D {...p}/>;`, 'date-input');
  blocked(`import S from '@/components/Select'; const ui=<S style={{paddingRight:0}}/>;`, 'select');
  blocked(`import S from '@/components/Select'; const styles={width:100,paddingInlineEnd:0}; const ui=<S style={styles}/>;`, 'select');
  clean(`import S from '@/components/Select'; const styles={width:'100%',marginTop:8}; const ui=<S style={styles}/>;`);
  blocked(`import S from '@/components/Select'; const ui=<S style={unknownStyles}/>;`, 'select');
  blocked(`import Toggle from '@/components/SegmentedControl'; const ui=<Toggle style={{padding:0}}/>;`, 'segmented');
  blocked(`import Popup from '../MonthlyReview/MonthlyDialog'; const ui=<Popup align="tl tl"/>;`, 'dialog');
  blocked(`import H from '@/components/PageHeader'; const ui=<H style={{height:200}}/>;`, 'page-header');
  blocked(`import T from '@/components/Financial/CalculatorLayout/FeeComparisonTable'; const ui=<T className="other"/>;`, 'comparison-table');
});
test('privileged CSS imports stay private, public templates remain importable', () => {
  blocked(`import '@/components/DateInput/style.css';`, 'date-input');
  blocked(`import '../../components/PageHeader/index.module.css';`, 'page-header');
  clean(`import '@/components/ToolPage/style.css'; import '@/components/Financial/CalculatorLayout/style.css';`);
  assert.ok(css(`@import url("../../components/DateInput/style.css");`, 'src/pages/Example/style.css').some(x => x.rule==='date-input'));
});
test('reserved selectors and variables have one style owner', () => {
  for (const [text,id] of [
    ['.app-date-input {height:99px}', 'date-input'], ['.next-select-values {padding:0}', 'select'],
    ['.segmented-control button {background:red}', 'segmented'], ['.next-dialog-header {padding:0}', 'dialog'],
    ['.tool-page {background:red}', 'tool-template'], ['.financial-calculator {padding:0}', 'financial-template'],
    ['.sf-comparison-table td {padding:0}', 'comparison-table'], ['.page {--date-input-height:99px}', 'date-input'],
    ['.page {--select-arrow-inset:0}', 'select'], ['input[type="date"]::-webkit-date-and-time-value {line-height:1px}', 'date-input'],
    ['select {background-position-x:right}', 'select'], ['select {padding-inline:0}', 'select'],
  ]) assert.ok(css(text, 'src/pages/Example/style.css').some(x=>x.rule===id),text);
  assert.deepEqual(css('.app-date-input {--date-input-height:42px}', 'src/components/DateInput/style.css'), []);
  assert.deepEqual(css('.business-row {display:flex;gap:12px} input[type="text"] {padding:8px}', 'src/pages/Example/style.css'), []);
});
test('business class aliases cannot override component internals; dialog content is public', () => {
  const usage=new Map();
  assert.deepEqual(code(`import S from '@/components/SegmentedControl'; import D from '@/components/ToolPage/ToolDialog';const ui=<><S className="my-switch"/><D className="my-dialog"/></>;`,file,usage), []);
  assert.ok(css('.my-switch button {padding:0}', 'src/pages/Example/style.css',usage).length);
  assert.ok(css('.my-switch {background:red}', 'src/pages/Example/style.css',usage).length);
  assert.deepEqual(css('.my-switch {width:100%;margin-top:8px}', 'src/pages/Example/style.css',usage), []);
  assert.deepEqual(css('.my-dialog .business-table {padding:8px}', 'src/pages/Example/style.css',usage), []);
  assert.ok(css('.my-dialog .next-dialog-header {padding:0}', 'src/pages/Example/style.css',usage).length);
});
test('normal text, comments and independent controls are not mistaken for violations', () => {
  clean(`import { Input, Button } from '@alifd/next';const text='<input type="date">'; // window.confirm('x')`);
  assert.deepEqual(css('/* .app-date-input {height:0} */ .description {content:"select"}', 'src/pages/Example/style.css'), []);
});
test('CLI exits nonzero for a newly added violating page and returns to zero after repair', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'component-standards-'));
  try {
    fs.cpSync(path.resolve(__dirname,'../src'),path.join(directory,'src'),{recursive:true});
    snapshot(directory);
    fs.writeFileSync(path.join(directory,'src','ComponentRegression.tsx'),'export const ui=<input type="date"/>;');
    const args=['-e','require(process.argv[1]).main(process.argv[2])',path.resolve(__dirname,'../scripts/check-components.cjs'),directory];
    const failed=spawnSync(process.execPath,args,{encoding:'utf8'});
    assert.equal(failed.status,1);assert.match(failed.stderr,/ComponentRegression.tsx:1 \[date-input\]/);
    fs.writeFileSync(path.join(directory,'src','ComponentRegression.tsx'),`import DateInput from '@/components/DateInput'; export const ui=<DateInput/>;`);
    const fixed=spawnSync(process.execPath,args,{encoding:'utf8'});
    assert.equal(fixed.status,0,fixed.stderr);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
test('only Git-added lines are checked, including staged changes, untracked files and explicit commit ranges', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'component-diff-'));
  try {
    fs.mkdirSync(path.join(directory, 'src'));
    const target = path.join(directory, 'src/Legacy.tsx');
    const style = path.join(directory, 'src/style.css');
    const original = 'export const legacy = <input type="date"/>;\n';
    fs.writeFileSync(target, original);
    fs.writeFileSync(style, '.app-date-input {\n  height: 99px;\n}\n');
    const base = snapshot(directory);
    assert.deepEqual(checkProject(directory), []);
    fs.writeFileSync(target, original + 'export const label = "new text";\n');
    assert.deepEqual(checkProject(directory), []); // Historical date survives an unrelated edit in the same file.
    fs.writeFileSync(target, original + 'export const added = <select/>;\n');
    git(directory, 'add', 'src/Legacy.tsx');
    assert.deepEqual(checkProject(directory).map(x => x.split(' ')[0]), ['src/Legacy.tsx:2']);
    fs.writeFileSync(target, original + 'export const added = <input type="text"/>;\n');
    assert.deepEqual(checkProject(directory), []); // Working tree repairs staged violation.
    fs.writeFileSync(style, '.app-date-input {\n  height: 99px;\n  padding: 0;\n}\n');
    assert.ok(checkProject(directory).some(x => x.startsWith('src/style.css:3 ')));
    assert.ok(!checkProject(directory).some(x => x.startsWith('src/style.css:2 ')));
    fs.writeFileSync(style, '.app-date-input {\n  height: 99px;\n}\n');
    const added = path.join(directory, 'src/New.tsx');
    fs.writeFileSync(added, 'export const ui = <input type="date"/>;');
    assert.ok(checkProject(directory).some(x => x.startsWith('src/New.tsx:1 ')));
    git(directory, 'add', '.');
    git(directory, '-c', 'user.name=Component Test', '-c', 'user.email=component-test@example.invalid', 'commit', '-qm', 'new work');
    assert.deepEqual(checkProject(directory), []);
    assert.ok(checkProject(directory, { base }).some(x => x.startsWith('src/New.tsx:1 ')));
    fs.unlinkSync(added);
    assert.deepEqual(checkProject(directory), []); // Deleted code does not create a violation.
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('sortable headers protect their shared layout and allow sorting callbacks', () => {
  clean(`import H from '@/components/ToolPage/SortableTableHeader'; const ui=<H label="XIRR" direction="asc" onClick={toggle}/>;`);
  blocked(`import H from '@/components/ToolPage/SortableTableHeader'; const ui=<H label="XIRR" style={{padding:0}}/>;`, 'sortable-header');
  assert.ok(css('.tool-sort-header button { padding: 10px; }', 'src/pages/Example/style.css').some(issue => issue.rule === 'sortable-header'));
});
