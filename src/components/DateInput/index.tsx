import React, { forwardRef } from 'react';
import './style.css';

export type DateInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'style'> & {
  density?: 'regular' | 'responsive';
};

// The journal's native-date alignment is shared by all consumers. The actual
// date input and its callbacks/validation remain native; only geometry is fixed.
const geometry: React.CSSProperties = {
  display: 'block',
  width: '100%',
  minWidth: 0,
  minInlineSize: 0,
  maxWidth: '100%',
  height: 'var(--date-input-height)',
  boxSizing: 'border-box',
  paddingTop: 0,
  paddingBottom: 0,
  appearance: 'none',
  WebkitAppearance: 'none',
  lineHeight: 'calc(var(--date-input-height) - 2px)',
  textAlign: 'left',
};

export default forwardRef<HTMLInputElement, DateInputProps>(function DateInput({ density = 'regular', className, ...props }, ref) {
  return <input {...props} ref={ref} type="date"
    className={['app-date-input', `app-date-input--${density}`, className].filter(Boolean).join(' ')}
    style={geometry} />;
});
