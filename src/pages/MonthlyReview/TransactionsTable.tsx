import React from 'react';
import { Transaction } from './workbook';

const selectAmount = (event: React.SyntheticEvent<HTMLInputElement>) => event.currentTarget.select();

export const blankTransaction = (date: string): Transaction => ({ date, kind: 'buy', amount: 0, shares: 0, price: 0 });
interface Props { rows: Transaction[]; onChange: (rows: Transaction[]) => void; date: string; disabled?: boolean; labelPrefix?: string; }
export default function TransactionsTable({ rows, onChange, date, disabled = false, labelPrefix = '交易' }: Props) {
  return <div className="mr-transactions-editor">
    <div className="mr-table-wrap"><table><thead><tr><th>日期</th><th>类型</th><th>金额（实际收付）</th><th>份额</th><th>价格 / 净值</th><th>操作</th></tr></thead><tbody>{rows.map((row, i) => {
      const update = (patch: Partial<Transaction>) => onChange(rows.map((value, j) => j === i ? { ...value, ...patch } : value));
      const label = `${labelPrefix}${i + 1}`;
      return <tr key={i}>
        <td><input aria-label={`${label}日期`} disabled={disabled} type="date" value={row.date} onChange={e => update({ date: e.target.value })} /></td>
        <td><select aria-label={`${label}类型`} disabled={disabled} value={row.kind} onChange={e => update({ kind: e.target.value as Transaction['kind'], shares: e.target.value === 'dividend' ? 0 : row.shares })}><option value="buy">买入</option><option value="sell">卖出</option><option value="dividend">分红</option></select></td>
        <td><input aria-label={`${label}金额`} disabled={disabled} onFocus={selectAmount} onClick={selectAmount} type="number" step="any" min="0" value={row.amount} onChange={e => { const amount = Number(e.target.value); update({ amount, price: row.shares ? amount / row.shares : row.price }); }} /></td>
        <td><input aria-label={`${label}份额`} disabled={disabled || row.kind === 'dividend'} onFocus={selectAmount} onClick={selectAmount} type="number" step="any" min="0" value={row.shares} onChange={e => { const shares = Number(e.target.value); update({ shares, price: shares ? row.amount / shares : row.price }); }} /></td>
        <td><input aria-label={`${label}价格`} disabled={disabled} onFocus={selectAmount} onClick={selectAmount} type="number" step="any" min="0" value={row.price} onChange={e => update({ price: Number(e.target.value) })} /></td>
        <td><button type="button" className="danger" disabled={disabled} onClick={() => onChange(rows.filter((_, j) => j !== i))}>删除</button></td>
      </tr>;
    })}</tbody></table>{!rows.length && <p>尚未登记交易，可添加记录，或直接填写净投入。</p>}</div>
    <button type="button" disabled={disabled} onClick={() => onChange([...rows, blankTransaction(date)])}>＋ 添加交易</button>
  </div>;
}
