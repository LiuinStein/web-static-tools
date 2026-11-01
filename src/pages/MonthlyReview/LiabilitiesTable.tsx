import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Liability, MonthlyWorkbook } from './workbook';
import { Scalar } from './formula';
import { balancePaste, MonthlyBatch, productKey } from './batch';

interface Props {
  book: MonthlyWorkbook; batch: MonthlyBatch | null; busy: boolean; money: (value: Scalar) => string;
  onStart: () => void; onBatch: (next: MonthlyBatch) => void; onError: (message: string) => void;
  onEdit: (row: Liability) => void; onZero: (row: Liability) => void;
}
export default function LiabilitiesTable({ book, batch, busy, money, onStart, onBatch, onError, onEdit, onZero }: Props) {
  const [query, setQuery] = useState(''), [unchecked, setUnchecked] = useState(false);
  const [sort, setSort] = useState<{ field: 'account' | 'balance'; direction: 'asc' | 'desc' } | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const table = useRef<HTMLDivElement>(null), reviewOnBlur = useRef<string | null>(null);
  const rows = useMemo(() => book.liabilities(), [book]);
  const changed = batch?.changedKeys() || new Set<string>(), invalid = new Set(batch?.invalidBalances);
  const sorted = (items: Liability[], next = sort) => !next ? [...items] : [...items].sort((a, b) => (next.field === 'account' ? a.account.localeCompare(b.account, 'zh-CN', { numeric: true }) : a.balance - b.balance) * (next.direction === 'asc' ? 1 : -1));
  const layout = rows.map(productKey).join('|');
  useEffect(() => { setOrder(batch ? sorted(rows).map(productKey) : null); if (!batch) setUnchecked(false); }, [Boolean(batch), layout]);
  const ranks = new Map((order || []).map((key, index) => [key, index]));
  const filtered = rows.filter(row => row.account.toLowerCase().includes(query.toLowerCase()) && (!batch || !unchecked || !batch.reviewed.has(productKey(row))));
  const displayed = batch && order ? [...filtered].sort((a, b) => (ranks.get(productKey(a)) ?? Infinity) - (ranks.get(productKey(b)) ?? Infinity)) : sorted(filtered);
  function heading(label: string, field: 'account' | 'balance') {
    const active = sort?.field === field ? sort.direction : null;
    return <th aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}><button className="mr-sort-button" disabled={busy} aria-label={`按负债${label}排序`} title="点击切换升序、降序、原始顺序" onClick={() => {
      const next = sort?.field !== field ? { field, direction: 'asc' as const } : sort.direction === 'asc' ? { field, direction: 'desc' as const } : null;
      setSort(next); if (batch) setOrder(sorted(rows, next).map(productKey));
    }}>{label}<span aria-hidden="true">{active === 'asc' ? '↑' : active === 'desc' ? '↓' : '↕'}</span></button></th>;
  }
  function finishInput(key: string) {
    if (!batch) return;
    const committed = batch.commitInputs(), review = reviewOnBlur.current === key;
    reviewOnBlur.current = null;
    const next = review ? committed.check([key], true) : committed;
    if (next !== batch) onBatch(next);
  }
  function move(event: React.KeyboardEvent<HTMLInputElement>, key: string) {
    if (event.key === 'Escape') { event.preventDefault(); table.current?.focus(); return; }
    if (!batch || !['Tab', 'Enter'].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
    const inputs = Array.from(table.current?.querySelectorAll<HTMLInputElement>('[data-liability-balance]') || []), index = inputs.indexOf(event.currentTarget);
    if (index < 0 || !inputs.length) return;
    event.preventDefault(); reviewOnBlur.current = key;
    const next = inputs[(index + (event.shiftKey ? -1 : 1) + inputs.length) % inputs.length];
    if (next === event.currentTarget) event.currentTarget.blur();
    next.focus(); next.select();
  }
  return <section className="mr-panel"><div className="mr-section-heading"><div><h2>负债记录</h2><p>金额为人民币；余额调整后自动更新负债合计和家庭净资产。</p></div>{!batch && <button disabled={busy || !rows.length} onClick={onStart}>批量记账</button>}</div>
    <div className="mr-filters"><input aria-label="搜索负债账户" placeholder="搜索负债账户" value={query} onChange={e => setQuery(e.target.value)} /><span className="mr-liability-total">本期负债合计：¥ {money(book.value('Liabilities', 'D1'))}</span></div>
    {batch && <div className="mr-batch-help"><p>金额输入在失去焦点后重算。直接修改本期余额，Tab / 回车核对并跳至下一行，Esc 退出连续录入；支持粘贴一列余额。通过「编辑」修改余额及还款日，「清零」将余额置为 0，所有修改统一保存或取消。</p><div className="mr-toolbar-group"><label><input type="checkbox" checked={unchecked} onChange={e => setUnchecked(e.target.checked)} />仅看未核对</label><button disabled={busy || !displayed.length} onClick={() => onBatch(batch.check(displayed.map(productKey), true))}>将当前可见项标为已核对</button><button disabled={busy || !rows.some(row => batch.reviewed.has(productKey(row)))} onClick={() => onBatch(batch.check(rows.map(productKey), false))}>清除核对标记</button></div></div>}
    <div className="mr-table-wrap mr-assets-table mr-liabilities-table" ref={table} tabIndex={-1} aria-label="负债表格"><table><thead><tr>{batch && <th>核对</th>}{heading('账户', 'account')}<th>上期余额</th><th>还款日</th><th>操作</th>{heading('本期余额', 'balance')}</tr></thead><tbody>{displayed.map(row => {
      const key = productKey(row), bad = invalid.has(key);
      return <tr key={key} className={batch && changed.has(key) ? 'mr-balance-changed' : undefined}>
        {batch && <td><input type="checkbox" aria-label={`${row.account} 已核对`} checked={batch.reviewed.has(key)} disabled={busy || bad} onChange={e => onBatch(batch.check([key], e.target.checked))} /></td>}
        <td><strong className="mr-product-name"><span>{row.account}</span>{batch && <span className={`mr-change-tag ${batch.reviewed.has(key) ? 'reviewed' : ''}`}>{batch.reviewed.has(key) ? '已核对' : changed.has(key) ? '已修改' : ''}</span>}</strong></td>
        <td>{money(row.previous)}</td><td>{row.repayment == null || row.repayment === '' ? '—' : String(row.repayment)}</td>
        <td><div className="mr-row-actions"><button disabled={busy} onClick={() => onEdit(row)}>编辑</button><button disabled={busy} onClick={() => onZero(row)}>清零</button></div></td>
        <td>{batch ? <><input onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()} data-liability-balance={key} type="text" inputMode="decimal" autoComplete="off" aria-label={`${row.account} 本期余额`} aria-invalid={bad} aria-describedby={bad ? `debt-error-${key}` : undefined} disabled={busy} value={batch.inputs.get(key) ?? String(row.balance)} onChange={e => onBatch(batch.stageBalances([[key, e.target.value]]))} onBlur={() => finishInput(key)} onKeyDown={e => move(e, key)} onPaste={e => {
          const text = e.clipboardData.getData('text'); if (!/[\r\n\t]/.test(text)) return; e.preventDefault();
          try { onBatch(batch.stageBalances(balancePaste(displayed, key, text))); onError(''); } catch (error) { onError(error.message); }
        }} />{bad && <small id={`debt-error-${key}`} className="mr-input-error">请输入有效的非负余额</small>}</> : money(row.balance)}</td>
      </tr>;
    })}</tbody></table>{!displayed.length && <p>{batch ? '没有匹配账户，或当前账户均已核对。' : '没有匹配的负债账户。'}</p>}</div>
  </section>;
}
