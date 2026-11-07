import React, { useEffect, useState } from 'react';
import { formatFixedAmount, rawAmount } from './amount';

// Preserve intermediate text such as "1." while the parent updates numeric calculations.
export default function AmountInput({ value, onFocus, onBlur, onChange, onClick, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  useEffect(() => {
    // A paste or recalculation may update the field externally; keep a typed trailing dot.
    if (editing && !Object.is(Number(rawAmount(text)), Number(rawAmount(String(value ?? ''))))) {
      setText(rawAmount(String(value ?? '')));
    }
  }, [value]);
  return <input {...props} type="text" inputMode="decimal" onClick={onClick}
    value={editing ? text : formatFixedAmount(String(value ?? ''))}
    onFocus={event => { const raw = rawAmount(String(value ?? '')); event.currentTarget.value = raw; setText(raw); setEditing(true); onFocus?.(event); }}
    onBlur={event => { setEditing(false); onBlur?.(event); }}
    onChange={event => { setText(event.target.value); onChange?.(event); }} />;
}
