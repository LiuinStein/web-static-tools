import React from 'react';
import './style.css';

interface Option<T extends string> { value: T; label: React.ReactNode; disabled?: boolean; }
interface Props<T extends string> {
  value: T;
  options: ReadonlyArray<Option<T>>;
  onChange: (value: T) => void;
  'aria-label': string;
  className?: string;
  disabled?: boolean;
}

export default function SegmentedControl<T extends string>({ value, options, onChange, className, disabled, ...props }: Props<T>) {
  return <div role="group" aria-label={props['aria-label']} className={['segmented-control', className].filter(Boolean).join(' ')}>
    {options.map(option => <button key={option.value} type="button" disabled={disabled || option.disabled}
      aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}
