const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
let states=[], cursor=0;
const mockReact={...React,useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];}};
function load(file){const m={exports:{}};new Function('exports','require','module',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText)(m.exports,name=>name==='react'?mockReact:name==='./SeveranceCalculator'?{default:()=>null,__esModule:true}:name==='./model'?load('src/pages/SalaryTools/model.ts'):name.endsWith('.css')?{}:require(name),m);return m.exports;}
const Page=load('src/pages/SalaryTools/index.tsx').default;
function render(){cursor=0;return Page();}
function all(node,predicate,result=[]){if(Array.isArray(node))node.forEach(n=>all(n,predicate,result));else if(node&&typeof node==='object'){if(predicate(node))result.push(node);all(node.props?.children,predicate,result);}return result;}
function input(tree,label){return all(tree,n=>n.type==='label'&&n.props.children?.[0]?.props?.children===label)[0].props.children[1];}
let tree=render();
assert.equal(all(tree,n=>n.type==='button'&&n.props['aria-pressed']===true&&n.props.children==='基本工资月数').length,2);
assert.equal(input(tree,'基本工资（元 / 月）').props.value,'50000');
assert.equal(input(tree,'股权激励应税所得（个月基本工资 / 年）').props.value,'0');
assert.equal(input(tree,'社保申报基数（元 / 月）').props.value,36348);
assert.equal(input(tree,'公积金申报基数（元 / 月）').props.value,36348);
assert.ok(all(tree,n=>n.type==='label'&&n.props.className?.includes('salary-field-wide')).length>=2);
let salary=input(tree,'基本工资（元 / 月）');let selected=false;salary.props.onFocus({currentTarget:{select(){selected=true;}}});assert.ok(selected);
salary.props.onChange({target:{value:''}});tree=render();assert.equal(input(tree,'基本工资（元 / 月）').props.value,'');assert.equal(all(tree,n=>n.props?.role==='alert').length,1);
input(tree,'基本工资（元 / 月）').props.onChange({target:{value:'40000'}});tree=render();assert.equal(all(tree,n=>n.props?.role==='alert').length,0);
assert.equal(input(tree,'年终奖（个月基本工资 / 年）').props.value,'4');
all(tree,n=>n.type==='button'&&n.props.children==='直接输入金额')[0].props.onClick();tree=render();assert.equal(input(tree,'年终奖（元 / 年）').props.value,'160000');
input(tree,'年终奖（元 / 年）').props.onChange({target:{value:'100000'}});tree=render();all(tree,n=>n.type==='button'&&n.props.children==='基本工资月数')[0].props.onClick();tree=render();assert.equal(input(tree,'年终奖（个月基本工资 / 年）').props.value,'2.5');
input(tree,'股权激励应税所得（个月基本工资 / 年）').props.onChange({target:{value:'1.5'}});tree=render();all(tree,n=>n.type==='button'&&n.props.children==='直接输入金额')[1].props.onClick();tree=render();assert.equal(input(tree,'股权激励应税所得（元 / 年）').props.value,'60000');
input(tree,'基本工资（元 / 月）').props.onChange({target:{value:'10000'}});tree=render();
assert.equal(input(tree,'社保申报基数（元 / 月）').props.value,17083.33);
assert.equal(input(tree,'公积金申报基数（元 / 月）').props.value,17083.33);
input(tree,'北京市最高缴费基数（元 / 月）').props.onChange({target:{value:'10000'}});tree=render();
assert.equal(input(tree,'社保申报基数（元 / 月）').props.value,10000);
assert.equal(input(tree,'公积金申报基数（元 / 月）').props.value,10000);
all(tree,n=>n.type==='input'&&n.props.type==='checkbox')[0].props.onChange({target:{checked:false}});tree=render();
input(tree,'社保申报基数（元 / 月）').props.onChange({target:{value:'8000'}});tree=render();
assert.equal(input(tree,'社保申报基数（元 / 月）').props.value,'8000');
all(tree,n=>n.type==='button'&&n.props.children==='恢复默认')[0].props.onClick();tree=render();
assert.equal(input(tree,'基本工资（元 / 月）').props.value,'50000');
assert.equal(input(tree,'年终奖（个月基本工资 / 年）').props.value,'4');
assert.equal(input(tree,'股权激励应税所得（个月基本工资 / 年）').props.value,'0');
assert.equal(input(tree,'社保申报基数（元 / 月）').props.value,36348);
console.log('Input checks passed: clear, select, retype, default month modes, salary linkage, mode conversion and fractional months.');
