import React from 'react';
import './style.css';

interface Props {
  label: string;
  direction: 'asc' | 'desc' | null;
  onClick: () => void;
}

export default function SortableTableHeader({ label, direction, onClick }: Props) {
  return <th scope="col" className="tool-sort-header" aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}>
    <button type="button" aria-label={`按${label}排序`} title="点击切换升序、降序、原始顺序" onClick={onClick}>
      {label}<span aria-hidden="true">{direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}</span>
    </button>
  </th>;
}
