import React, { useEffect, useRef, useState } from 'react';
import { MonthlyWorkbook, Product } from './workbook';
import { Scalar } from './formula';
import { isCashAccount } from './categories';
import { MonthlyBatch, productKey, balancePaste } from './batch';
import { ProductSort, ProductSortField, nextProductSort, sortedProducts } from './sorting';

interface Props {
  book: MonthlyWorkbook; products: Product[]; batch: MonthlyBatch | null; busy: boolean;
  categoryNames: Record<string, string>; money: (n: Scalar) => string; pct: (n: Scalar) => string;
  onBatch: (batch: MonthlyBatch) => void; onError: (message: string) => void;
  onEdit: (p: Product) => void; onTransactions: (p: Product) => void; onDelete: (p: Product) => void;
}
export default function AssetsTable({ book, products, batch, busy, categoryNames, money, pct, onBatch, onError, onEdit, onTransactions, onDelete }: Props) {
  const table = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useState<ProductSort | null>(null);
  const [batchOrder, setBatchOrder] = useState<string[] | null>(null);
  const changed = batch?.changedKeys() || new Set<string>(), invalid = new Set(batch?.invalid);
  const invalidBalances = new Set(batch?.invalidBalances), invalidFlows = new Set(batch?.invalidFlows);
  const layout = book.products().map(productKey).join('|');
  useEffect(() => {
    // Keep rows still while entering values; refresh ordering when the user clicks a header.
    setBatchOrder(batch ? sortedProducts(book.products(), book, sort, new Set(batch.invalid)).map(productKey) : null);
  }, [Boolean(batch), layout]);
  const ranks = new Map((batchOrder || []).map((key, index) => [key, index]));
  const displayed = batch && batchOrder
    ? [...products].sort((a, b) => (ranks.get(productKey(a)) ?? Infinity) - (ranks.get(productKey(b)) ?? Infinity))
    : sortedProducts(products, book, sort, invalid);
  const value = (p: Product, column: string) => invalid.has(productKey(p)) ? null : book.value(p.sheet, `${column}${p.row}`);
  function toggleSort(field: ProductSortField) {
    const next = nextProductSort(sort, field); setSort(next);
    if (batch) setBatchOrder(sortedProducts(book.products(), book, next, invalid).map(productKey));
  }
  function heading(label: string, field: ProductSortField) {
    const direction = sort?.field === field ? sort.direction : null;
    return <th key={field} aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}><button className="mr-sort-button" aria-label={`按${field === 'name' ? '产品名称' : label}排序`} disabled={busy} onClick={() => toggleSort(field)} title="点击切换升序、降序、原始顺序">{label}<span aria-hidden="true">{direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}</span></button></th>;
  }
  function move(event: React.KeyboardEvent<HTMLInputElement>, key: string) {
    if (event.key === 'Escape') { event.preventDefault(); table.current?.focus(); return; }
    if (!batch || !['Enter', 'Tab'].includes(event.key) || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing) return;
    const inputs = Array.from(table.current?.querySelectorAll<HTMLInputElement>('[data-balance-input]') || []);
    if (!inputs.length) return;
    event.preventDefault();
    const index = inputs.indexOf(event.currentTarget);
    // Clicking a net-investment input does not add that column to the Tab sequence.
    const next = index < 0 ? inputs.find(input => input.dataset.balanceInput === key) : inputs[(index + (event.shiftKey ? -1 : 1) + inputs.length) % inputs.length];
    if (next) { next.focus(); next.select(); }
    if (index >= 0 && !invalid.has(key)) onBatch(batch.check([key], true));
  }
  return <div className="mr-table-wrap mr-assets-table" ref={table} tabIndex={-1} aria-label="资产表格"><table><thead><tr>
    {batch && <th>核对</th>}{heading('产品 / 账户', 'name')}<th>成员 / 币种</th>{batch && <th>上期余额</th>}
    {heading('较上次收益', 'gain')}{heading('XIRR', 'xirr')}{heading('年化 TWR', 'twr')}<th>操作</th><th>净投入</th>{heading('本期余额', 'balance')}
  </tr></thead><tbody>{displayed.map(p => {
    const key = productKey(p), bad = invalidBalances.has(key), badFlow = invalidFlows.has(key);
    return <tr key={key} className={batch && changed.has(key) ? 'mr-balance-changed' : undefined}>
      {batch && <td><input type="checkbox" aria-label={`${p.name} 已核对`} checked={batch.reviewed.has(key)} disabled={busy || invalid.has(key)} onChange={e => onBatch(batch.check([key], e.target.checked))} /></td>}
      <td><strong className="mr-product-name"><span>{p.name}</span>{batch && <span className={`mr-change-tag ${batch.reviewed.has(key) ? 'reviewed' : ''}`}>{batch.reviewed.has(key) ? '已核对' : changed.has(key) ? '已修改' : ''}</span>}</strong><small>{p.account} · {categoryNames[p.category] || p.category}</small></td>
      <td>{p.member}<small>{p.currency}</small></td>
      {batch && <td>{money(p.previous)}</td>}
      <td>{money(value(p, 'J'))}</td><td title={String(value(p, 'K') || '')}>{pct(value(p, 'K'))}</td><td>{pct(value(p, 'L'))}</td>
      <td><div className="mr-row-actions"><button disabled={busy} onClick={() => onEdit(p)}>编辑</button><button disabled={busy} onClick={() => onTransactions(p)}>买卖记录</button><button className="danger" disabled={busy} onClick={() => onDelete(p)}>删除</button></div></td>
      <td>{batch ? <><input data-flow-input={key} tabIndex={-1} aria-label={`${p.name} 净投入`} aria-invalid={badFlow} aria-describedby={badFlow ? `flow-error-${key}` : undefined} type="text" inputMode="decimal" autoComplete="off" readOnly={isCashAccount(p.category)} title={isCashAccount(p.category) ? '活期账户净投入 = 本期余额 − 上期余额，自动计算' : '投入为正，回款为负；保存买卖记录后会按流水重新汇总'} value={batch.flows.get(key) ?? (typeof p.flow === 'number' ? String(p.flow) : '')} placeholder={typeof p.flow === 'string' ? p.flow : '0'} disabled={busy} onChange={e => { if (!isCashAccount(p.category)) onBatch(batch.cashFlows([[key, e.target.value]])); }} onKeyDown={e => move(e, key)} />{badFlow && <small id={`flow-error-${key}`} className="mr-input-error">请输入有效的净投入金额</small>}</> : money(p.flow)}</td>
      <td>{batch ? <><input data-balance-input={key} aria-label={`${p.name} 本期余额`} aria-invalid={bad} aria-describedby={bad ? `balance-error-${key}` : undefined} type="text" inputMode="decimal" autoComplete="off" value={batch.inputs.get(key) ?? String(p.balance)} disabled={busy} onChange={e => onBatch(batch.balances([[key, e.target.value]]))} onKeyDown={e => move(e, key)} onPaste={e => {
        const text = e.clipboardData.getData('text');
        if (!/[\r\n\t]/.test(text)) return;
        e.preventDefault();
        try { onBatch(batch.balances(balancePaste(displayed, key, text))); onError(''); } catch (error) { onError(error.message); }
      }} />{bad && <small id={`balance-error-${key}`} className="mr-input-error">请输入有效的非负余额</small>}</> : money(p.balance)}</td>

    </tr>;
  })}</tbody></table>{!displayed.length && <p>{batch ? '没有匹配产品，或当前产品均已核对。' : '没有匹配产品。'}</p>}</div>;
}
