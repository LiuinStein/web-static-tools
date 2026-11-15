import React, { useEffect, useRef, useState } from 'react';
import ExpandableText from '@/components/ExpandableText';
import ConfirmPopover from '@/components/ConfirmPopover';

interface Props { name: string; note: string; busy: boolean; onSave?: (note: string) => Promise<void>; }
// One stateful note editor owns the adjacent note and action cells.
export default function NoteCell({ name, note, busy, onSave }: Props) {
  const [editing, setEditing] = useState(false), [text, setText] = useState(note);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const cancel = () => { setEditing(false); setText(note); setError(''); };
  async function save(nextText = text) {
    if (saving || busy || !onSave) return;
    if (nextText === note) { cancel(); return; }
    setSaving(true); setError('');
    try { await onSave(nextText); if (mounted.current) { setEditing(false); setText(nextText); } }
    catch (e) { if (mounted.current) setError(e.message || '备注未保存，请重试。'); }
    finally { if (mounted.current) setSaving(false); }
  }
  return <>
    <td className="mr-note-cell">
      {editing ? <div className="mr-note-editor"><textarea aria-label={name + ' 备注'} rows={5} autoFocus value={text} disabled={busy || saving} onChange={event => setText(event.target.value)} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape' && !busy && !saving) { event.preventDefault(); cancel(); }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); }
      }} /></div> : <ExpandableText text={note} label={name + '的备注'} />}
      {error && <div className="mr-input-error" role="alert">{error}</div>}
    </td>
    <td>{onSave && <div className="mr-row-actions">{editing ? <>
      <button type="button" className="tool-button--small" aria-label={'取消编辑 ' + name + ' 的备注'} disabled={busy || saving} onClick={cancel}>取消</button>
      <button type="button" className="tool-button--small primary" disabled={busy || saving} onClick={() => { void save(); }}>{saving ? '保存中…' : '保存'}</button>
    </> : <>
      <button type="button" className="tool-button--small" aria-label={'编辑 ' + name + ' 的备注'} disabled={busy || saving} onClick={() => { setConfirming(false); setText(note); setError(''); setEditing(true); }}>编辑</button>
      <ConfirmPopover visible={confirming} onVisibleChange={setConfirming} disabled={busy || saving} message={`确定清空“${name}”的备注吗？`} onConfirm={() => save('')}>
        <button type="button" className="tool-button--small tool-button--danger" aria-label={'清空 ' + name + ' 的备注'} title="清空备注前需确认" disabled={busy || saving}>取消</button>
      </ConfirmPopover>
    </>}</div>}</td>
  </>;
}
