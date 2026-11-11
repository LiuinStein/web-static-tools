const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
function load(file, resolve) { const m={exports:{}};new Function('exports','require','module',transpile(file))(m.exports,resolve,m);return m.exports.default; }
test('shared dialog preserves portal close options and gives every variant the shared theme', () => {
  const Next = () => null;
  const Dialog = load('src/components/ToolPage/ToolDialog.tsx', name => name==='react'?React:{Dialog:Next});
  const onClose = () => {};
  const modal=Dialog({size:'wide',className:'feature-dialog',visible:true,overlayProps:{cache:true,wrapperClassName:'feature-overlay'},closeMode:['close','mask','esc'],onClose});
  assert.equal(modal.type,Next);assert.equal(modal.props.isFullScreen,true);assert.equal(modal.props.animation,false);
  assert.equal(modal.props.className,'tool-page tool-dialog tool-dialog--wide feature-dialog');
  assert.equal(modal.props.overlayProps.wrapperClassName,'tool-dialog-overlay feature-overlay');
  assert.equal(modal.props.overlayProps.cache,true);assert.equal(modal.props.onClose,onClose);
  assert.deepEqual(modal.props.closeMode,['close','mask','esc']);
});
test('confirmation only approves the intended action, cancels on dismissal and resolves on unmount', async () => {
  let slots=[],cursor=0,cleanup;
  const mock={...React,useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>slots[i]=v];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(effect){if(!cleanup)cleanup=effect();}};
  const useConfirm=load('src/components/ToolPage/useToolConfirm.tsx',name=>name==='react'?mock:{default:()=>null,__esModule:true});
  function render(){cursor=0;return useConfirm();}
  let api=render();const canceled=api.confirm({title:'删除',message:'删除记录？',danger:true});api=render();
  assert.equal(api.confirmationDialog.props.visible,true);
  assert.equal(await api.confirm({title:'其他操作',message:'不能替换待确认操作'}),false);
  api.confirmationDialog.props.onClose();assert.equal(await canceled,false);
  api=render();assert.equal(api.confirmationDialog.props.visible,false);
  const confirmed=api.confirm({title:'发布',message:'覆盖同名文件？'});api=render();
  const actions=api.confirmationDialog.props.children[1].props.children;
  actions[1].props.onClick();assert.equal(await confirmed,true);
  api=render();const unmounted=api.confirm({title:'未确认',message:'离开后应取消'});cleanup();assert.equal(await unmounted,false);
});
