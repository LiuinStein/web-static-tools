import React, { useEffect, useState } from 'react';
import { formatAmount, formatFixedAmount, rawAmount } from './amount';

// Preserve intermediate text such as "1." while the parent updates numeric calculations.
export default function AmountInput({ value, onFocus, onBlur, onChange, onClick, onKeyDown, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  useEffect(() => {
    // A paste or recalculation may update the field externally; keep a typed trailing dot.
    if (editing && !Object.is(Number(rawAmount(text)), Number(rawAmount(String(value ?? ''))))) {
      setText(formatAmount(String(value ?? '')));
    }
  }, [value]);
  return <input {...props} type="text" inputMode="decimal" onClick={onClick}
    value={editing ? text : formatFixedAmount(String(value ?? ''))}
    onFocus={event => { const formatted = formatAmount(String(value ?? '')); event.currentTarget.value = formatted; setText(formatted); setEditing(true); onFocus?.(event); }}
    onBlur={event => { setEditing(false); onBlur?.(event); }}
    onKeyDown={event => {
      const input = event.currentTarget, caret = input.selectionStart;
      // Delete the adjacent digit when the caret crosses a grouping separator.
      if (caret !== null && caret === input.selectionEnd && !input.readOnly && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        if (event.key === 'Backspace' && input.value[caret - 1] === ',') input.setSelectionRange(caret - 1, caret - 1);
        if (event.key === 'Delete' && input.value[caret] === ',') input.setSelectionRange(caret + 1, caret + 1);
      }
      onKeyDown?.(event);
    }}
    onChange={event => {
      const input = event.currentTarget;
      const entered = input.value;
      const start = rawAmount(entered.slice(0, input.selectionStart ?? entered.length)).length;
      const end = rawAmount(entered.slice(0, input.selectionEnd ?? entered.length)).length;
      const direction = input.selectionDirection || 'none';
      const formatted = formatAmount(entered);
      setText(formatted);
      onChange?.(event);
      input.value = formatted;
      const position = (offset: number) => {
        let index = 0, count = 0;
        while (index < formatted.length && count < offset) {
          if (formatted[index] !== ',') count += 1;
          index += 1;
        }
        return index;
      };
      input.setSelectionRange(position(start), position(end), direction);
    }} />;
}
