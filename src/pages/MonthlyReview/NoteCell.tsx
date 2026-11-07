import React, { useEffect, useRef, useState } from 'react';

interface Props { name: string; note: string; busy: boolean; onSave: (note: string) => Promise<void>; }
export default function NoteCell({ name, note, busy, onSave }: Props) {
  const [editing, setEditing] = useState(false), [text, setText] = useState(note);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const cancel = () => { setEditing(false); setText(note); setError(''); };
  async function save() {
    if (saving || busy) return;
    if (text === note) { cancel(); return; }
    setSaving(true); setError('');
    try { await onSave(text); if (mounted.current) setEditing(false); }
    catch (e) { if (mounted.current) setError(e.message || '备注未保存，请重试。'); }
    finally { if (mounted.current) setSaving(false); }
  }
  if (!editing) return <div className="mr-note-display"><span className="mr-note-text">{note}</span><button type="button" className="mr-note-edit" aria-label={'编辑 ' + name + ' 的备注'} disabled={busy} onClick={() => { setText(note); setError(''); setEditing(true); }}>编辑备注</button></div>;
  return <div className="mr-note-editor">
    <textarea aria-label={name + ' 备注'} rows={5} autoFocus value={text} disabled={busy || saving} onChange={event => setText(event.target.value)} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape' && !busy && !saving) { event.preventDefault(); cancel(); }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); }
    }} />
    {error && <div className="mr-input-error" role="alert">{error}</div>}
    <div className="mr-note-actions"><button type="button" disabled={busy || saving} onClick={cancel}>取消</button><button type="button" className="primary" disabled={busy || saving} onClick={() => { void save(); }}>{saving ? '保存中…' : '保存备注'}</button></div>
  </div>;
}
