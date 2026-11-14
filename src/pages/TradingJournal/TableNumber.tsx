import React from 'react';

export default function TableNumber({ value, minimumFractionDigits = 2, maximumFractionDigits = 4 }: {
  value?: number;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}) {
  if (value === undefined) return <>—</>;
  const [whole, fraction] = value.toLocaleString('zh-CN', { minimumFractionDigits, maximumFractionDigits }).split('.');
  return <span className="j-table-number"><span className="j-number-whole">{whole}</span>{fraction !== undefined && <span className="j-number-fraction">.{fraction}</span>}</span>;
}
