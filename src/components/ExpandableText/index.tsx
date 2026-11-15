import React from 'react';
import './style.css';

interface Props { text: string; label: string; }
export default function ExpandableText({ text, label }: Props) {
  return <details className="expandable-text">
    <summary aria-label={'展开或收起' + label} title="点击展开或收起">
      <span className="expandable-text__preview">{text || '—'}</span>
      <span className="expandable-text__collapse">收起</span>
    </summary>
    <div className="expandable-text__content">{text || '—'}</div>
  </details>;
}
