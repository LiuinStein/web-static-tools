import React from 'react';
export interface ComparisonColumn { id: string; name: string; plan: string; selected: boolean; error: string; source?: string; }
export interface ComparisonCell { value: string; detail?: string; }
export interface ComparisonRow { id: string; label: string; description?: string; cells: ComparisonCell[]; emphasis?: boolean; }
export default function FeeComparisonTable({ caption, columns, rows }: { caption: string; columns: ComparisonColumn[]; rows: ComparisonRow[] }) {
  const detailedRows = rows.filter(row => row.cells.some(cell => cell.detail));
  return <>
    <div className="sf-table-wrap sf-comparison-wrap" tabIndex={0} role="region" aria-label={caption}><table className={`sf-comparison-table${columns.length === 1 ? ' sf-comparison-table--single' : ''}`}><caption className="sf-sr-only">{caption}，最左列为字段说明，当前券商排在第一数据列</caption><thead><tr><th scope="col">字段说明</th>{columns.map(column => <th scope="col" key={column.id}><span>{column.source ? <a href={column.source} target="_blank" rel="noreferrer">{column.name}</a> : column.name}</span>{column.selected && <span className="sf-comparison-badge">当前</span>}<small>{column.plan}</small></th>)}</tr></thead><tbody>
      {columns.some(column => column.error) && <tr className="sf-comparison-status"><th scope="row">测算状态</th>{columns.map(column => <td key={column.id}>{column.error || '可比较'}</td>)}</tr>}
      {rows.map(row => <tr key={row.id} className={row.emphasis ? 'sf-comparison-total' : undefined}><th scope="row"><span>{row.label}</span>{row.description && <small className="sf-comparison-field-note">{row.description}</small>}</th>{row.cells.map((cell, index) => <td key={columns[index].id} title={cell.detail}>{cell.value}</td>)}</tr>)}
    </tbody></table></div>
    {detailedRows.length > 0 && <details className="sf-comparison-notes"><summary>查看各券商计费说明与买卖拆分</summary><div className="sf-comparison-notes-grid">{columns.map((column, index) => <section key={column.id}><h4>{column.name}</h4>{column.error ? <p>{column.error}</p> : <dl>{detailedRows.filter(row => row.cells[index].detail).map(row => <React.Fragment key={row.id}><dt>{row.label}</dt><dd>{row.cells[index].detail}</dd></React.Fragment>)}</dl>}</section>)}</div></details>}
  </>;
}
