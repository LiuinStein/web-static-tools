import React from 'react';
import './style.css';

interface Props { text: string; label: string; expandedLabel?: string; previewText?: string; }
export default function ExpandableText({ text, label, expandedLabel = '收起', previewText = text }: Props) {
  return <details className="expandable-text">
    <summary aria-label={'展开或收起' + label} title="点击展开或收起">
      <span className="expandable-text__preview">{previewText || '—'}</span>
      <span className="expandable-text__collapse">{expandedLabel}</span>
    </summary>
    <div className="expandable-text__content">{text || '—'}</div>
  </details>;
}
