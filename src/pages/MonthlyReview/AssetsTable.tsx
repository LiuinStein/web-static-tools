import NoteCell from './NoteCell';
import HoverHint from '@/components/HoverHint';
import { returnTimingHint, returnTimingRisk, DEFAULT_TIMING_THRESHOLD } from './return-timing';
import { Benchmarks, benchmarkRating } from './benchmarks';
import type { ReviewState } from './storage';
import AmountInput from './AmountInput';
import { sumAvailableAmounts } from './totals';
import Decimal from 'decimal.js';
import { rawAmount, currencyCode } from './amount';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MonthlyWorkbook, Product } from './workbook';
import { Scalar } from './formula';
import { isCashAccount, isBalanceOnly } from './categories';
import { displayValue } from './display';
import { MonthlyBatch, productKey, balancePaste } from './batch';
import { ProductSort, ProductSortField, nextProductSort, sortedProducts } from './sorting';
import { currentProductProfit } from './liquidity-analysis';

const gainClass = (value: Scalar) => typeof value === 'number' && value > 0 ? 'mr-gain-positive' : typeof value === 'number' && value < 0 ? 'mr-gain-negative' : undefined;

const selectAmount = (event: React.SyntheticEvent<HTMLInputElement>) => event.currentTarget.select();

interface Props {
  onExitForward?: () => void;
  onSaveNote?: (p: Product, note: string) => Promise<void>;
  benchmarks?: Benchmarks;
  timingThreshold?: number;
  reviewState?: ReviewState;
  notes?: boolean; book: MonthlyWorkbook; products: Product[]; batch: MonthlyBatch | null; busy: boolean;
  categoryNames: Record<string, string>; money: (n: Scalar) => string; pct: (n: Scalar) => string;
  onBatch: (batch: MonthlyBatch) => void; onError: (message: string) => void;
  onEdit: (p: Product) => void; onTransactions: (p: Product) => void; onDelete: (p: Product) => void;
}
export default function AssetsTable({ onExitForward, onSaveNote, benchmarks, timingThreshold = DEFAULT_TIMING_THRESHOLD, reviewState, notes = false, book, products, batch, busy, categoryNames, money, pct, onBatch, onError, onEdit, onTransactions, onDelete }: Props) {
  const table = useRef<HTMLDivElement>(null);
  const reviewOnBlur = useRef<string | null>(null);
  const allProducts = useMemo(() => book.products(), [book]);
  const [sort, setSort] = useState<ProductSort | null>({ field: 'name', direction: 'asc' });
  const [batchOrder, setBatchOrder] = useState<string[] | null>(null);
  const changed = batch?.changedKeys() || new Set(reviewState?.changed || []), invalid = new Set(batch?.invalid);
  const invalidBalances = new Set(batch?.invalidBalances), invalidFlows = new Set(batch?.invalidFlows);
  const layout = allProducts.map(productKey).join('|');
  useEffect(() => {
    // Keep rows still while entering values; refresh ordering when the user clicks a header.
    setBatchOrder(batch ? sortedProducts(allProducts, book, sort, new Set(batch.invalid)).map(productKey) : null);
  }, [Boolean(batch), layout]);
  const ranks = new Map((batchOrder || []).map((key, index) => [key, index]));
  const displayed = batch && batchOrder
    ? [...products].sort((a, b) => (ranks.get(productKey(a)) ?? Infinity) - (ranks.get(productKey(b)) ?? Infinity))
    : sortedProducts(products, book, sort, invalid);
  const currencyMoney = (p: Product, n: Scalar) => `${currencyCode(p.currency)} ${money(n)}`;
  const currentProfits = useMemo(() => new Map(notes ? [] : products.map(p => [productKey(p), invalid.has(productKey(p)) ? null : currentProductProfit(book, p)])), [book, products, notes, batch?.invalid.join('|')]);
  const currentProfit = (p: Product) => currentProfits.get(productKey(p)) ?? null;
  const value = (p: Product, column: string) => invalid.has(productKey(p)) || (isBalanceOnly(p.category) && ['K', 'L', 'M'].includes(column)) ? null : book.value(p.sheet, `${column}${p.row}`);
  function returnCell(p: Product, metric: 'xirr' | 'twr', risk: ReturnType<typeof returnTimingRisk>) {
    const rate = value(p, metric === 'xirr' ? 'K' : 'L'), rating = benchmarkRating(benchmarks, p.category, metric, rate);
    const hint = notes ? undefined : returnTimingHint(value(p, 'K'), value(p, 'L'), timingThreshold);
    const riskClass = risk === 'drag' || (risk === 'better' && metric === 'twr') ? 'mr-timing-risk-red' : risk === 'better' ? 'mr-timing-risk-yellow' : '';
    return <HoverHint content={hint ? [hint, rating.title].filter(Boolean).join('\n') : undefined}><td {...rating} className={[rating.className, riskClass].filter(Boolean).join(' ') || undefined} title={rating.title || (metric === 'xirr' ? displayValue(rate) : undefined)}>{pct(rate)}</td></HoverHint>;
  }
  function toggleSort(field: ProductSortField) {
    const next = nextProductSort(sort, field); setSort(next);
    if (batch) setBatchOrder(sortedProducts(allProducts, book, next, invalid).map(productKey));
  }
  function heading(label: string, field: ProductSortField) {
    const direction = sort?.field === field ? sort.direction : null;
    return <th key={field} aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}><button className="mr-sort-button" aria-label={`按${field === 'name' ? '产品名称' : label}排序`} disabled={busy} onClick={() => toggleSort(field)} title="点击切换升序、降序、原始顺序">{label}<span aria-hidden="true">{direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}</span></button></th>;
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
    if (!batch || !['Enter', 'Tab'].includes(event.key) || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing) return;
    const inputs = Array.from(table.current?.querySelectorAll<HTMLInputElement>('[data-balance-input]') || []);
    if (!inputs.length) return;
    event.preventDefault();
    const index = inputs.indexOf(event.currentTarget);
    if (index === inputs.length - 1 && !event.shiftKey && onExitForward) {
      reviewOnBlur.current = key;
      onExitForward();
      return;
    }
    // Clicking a net-investment input does not add that column to the Tab sequence.
    const next = index < 0 ? inputs.find(input => input.dataset.balanceInput === key) : inputs[(index + (event.shiftKey ? -1 : 1) + inputs.length) % inputs.length];
    if (index >= 0) reviewOnBlur.current = key;
    if (next === event.currentTarget) event.currentTarget.blur();
    if (next) { next.focus(); next.select(); }
  }
  return <div className="mr-table-wrap mr-assets-table" ref={table} tabIndex={-1} aria-label="资产表格"><table><thead><tr>
    {batch && <th>核对</th>}{heading('产品 / 账户', 'name')}<th>成员 / 币种</th>{heading('上期余额', 'previous')}
    {!notes && heading('累计收益', 'cumulativeProfit')}
    {heading('较上次收益', 'gain')}{heading('XIRR', 'xirr')}{heading('年化 TWR', 'twr')}{!notes && <th>操作</th>}<th>净投入</th>{heading('本期余额', 'balance')}{notes && <><th>备注</th><th>操作</th></>}
  </tr></thead><tbody>{displayed.map(p => {
    const key = productKey(p), bad = invalidBalances.has(key), badFlow = invalidFlows.has(key);
    const risk = notes ? undefined : returnTimingRisk(value(p, 'K'), value(p, 'L'), timingThreshold);
    return <tr key={key} className={changed.has(key) ? 'mr-balance-changed' : undefined}>
      {batch && <td><input type="checkbox" aria-label={`${p.name} 已核对`} checked={batch.reviewed.has(key)} disabled={busy || invalid.has(key)} onChange={e => onBatch(batch.check([key], e.target.checked))} /></td>}
      <td><strong className="mr-product-name"><span>{displayValue(p.name)}</span>{(batch || reviewState) && <span className={`mr-change-tag ${(batch ? batch.reviewed.has(key) : reviewState?.reviewed.includes(key)) ? 'reviewed' : ''}`}>{(batch ? batch.reviewed.has(key) : reviewState?.reviewed.includes(key)) ? '已核对' : changed.has(key) ? '已修改' : ''}</span>}</strong><small>{displayValue(p.account)} · {displayValue(categoryNames[p.category] || p.category)}</small></td>
      <td>{displayValue(p.member)}<small>{displayValue(p.currency)}</small></td>
      <td>{currencyMoney(p, p.previous)}</td>
      {!notes && <td className={[gainClass(currentProfit(p)), risk === 'drag' ? 'mr-timing-risk-red' : ''].filter(Boolean).join(' ') || undefined}>{currencyMoney(p, currentProfit(p))}</td>}
      <td className={[gainClass(value(p, 'J')), risk === 'drag' ? 'mr-timing-risk-red' : ''].filter(Boolean).join(' ') || undefined}>{money(value(p, 'J'))}</td>{returnCell(p, 'xirr', risk)}{returnCell(p, 'twr', risk)}
      {!notes && <td><div className="mr-row-actions"><button disabled={busy} onClick={() => onEdit(p)}>编辑</button><button disabled={busy || isBalanceOnly(p.category)} title={isBalanceOnly(p.category) ? '活期账户和定期存款不记录买卖流水，也不计算 XIRR / TWR' : undefined} onClick={() => onTransactions(p)}>买卖记录</button><button className="danger" disabled={busy} onClick={() => onDelete(p)}>删除</button></div></td>}
      <td>{batch ? <><AmountInput onFocus={selectAmount} onClick={selectAmount} data-flow-input={key} tabIndex={-1} aria-label={`${p.name} 净投入`} aria-invalid={badFlow} aria-describedby={badFlow ? `flow-error-${key}` : undefined} type="text" inputMode="decimal" autoComplete="off" readOnly={isCashAccount(p.category)} title={isCashAccount(p.category) ? '活期账户净投入 = 本期余额 − 上期余额，自动计算' : '投入为正，回款为负；保存买卖记录后会按流水重新汇总'} value={(batch.flows.get(key) ?? (typeof p.flow === 'number' ? String(p.flow) : ''))} placeholder={typeof p.flow === 'string' ? displayValue(p.flow) : '0'} disabled={busy} onChange={e => { if (!isCashAccount(p.category)) onBatch(batch.stageFlows([[key, rawAmount(e.target.value)]])); }} onBlur={() => finishInput(key)} onKeyDown={e => move(e, key)} />{badFlow && <small id={`flow-error-${key}`} className="mr-input-error">请输入有效的净投入金额</small>}</> : money(p.flow)}</td>
      <td>{batch ? <><span className="mr-currency-prefix">{currencyCode(p.currency)}</span><AmountInput onFocus={selectAmount} onClick={selectAmount} data-balance-input={key} aria-label={`${p.name} 本期余额`} aria-invalid={bad} aria-describedby={bad ? `balance-error-${key}` : undefined} type="text" inputMode="decimal" autoComplete="off" value={(batch.inputs.get(key) ?? String(p.balance))} disabled={busy} onChange={e => onBatch(batch.stageBalances([[key, rawAmount(e.target.value)]]))} onBlur={() => finishInput(key)} onKeyDown={e => move(e, key)} onPaste={e => {
        const text = e.clipboardData.getData('text');
        if (!/[\r\n\t]/.test(text)) return;
        e.preventDefault();
        try { onBatch(batch.stageBalances(balancePaste(displayed, key, text))); onError(''); } catch (error) { onError(error.message); }
      }} />{bad && <small id={`balance-error-${key}`} className="mr-input-error">请输入有效的非负余额</small>}</> : currencyMoney(p, p.balance)}</td>

      {notes && <NoteCell key={JSON.stringify([key, p.name, p.account])} name={p.name} note={p.note} busy={busy} onSave={onSaveNote ? note => onSaveNote(p, note) : undefined} />}
    </tr>;
  })}</tbody><tfoot>{[...new Set(displayed.map(p => p.currency))].map(code => {
    const rows = displayed.filter(p => p.currency === code);
    const gainTotal = sumAvailableAmounts(rows.map(p => value(p, 'J')));
    const profitTotal = sumAvailableAmounts(rows.map(currentProfit));
    const sum = (get: (p: Product) => Scalar, withCurrency = true) => {
      const values = rows.map(get);
      return values.every(n => typeof n === 'number' && Number.isFinite(n))
        ? (withCurrency ? currencyCode(code) + ' ' : '') + money(values.reduce<Decimal>((total, n) => total.plus(n as number), new Decimal(0)).toNumber()) : (withCurrency ? currencyCode(code) + ' ' : '') + '—';
    };
    return <tr key={code}>{batch && <td /> }<th scope="row">合计 · {currencyCode(code)}</th><td /><td>{sum(p => p.previous)}</td>{!notes && <td className={gainClass(profitTotal)} title="按币种合计当前可见产品的有效累计收益；不计入成本或余额待核实的产品">{currencyCode(code)} {money(profitTotal)}</td>}<td className={gainClass(gainTotal)} title="按币种加和当前可见产品的有效收益数值；不计入缺失或待核实的收益">{money(gainTotal)}</td><td /><td />{!notes && <td />}<td>{sum(p => invalidFlows.has(productKey(p)) ? null : p.flow, false)}</td><td>{sum(p => invalidBalances.has(productKey(p)) ? null : p.balance)}</td>{notes && <><td /><td /></>}</tr>;
  })}</tfoot></table>{!displayed.length && <p>{batch ? '没有匹配产品，或当前产品均已核对。' : '没有匹配产品。'}</p>}</div>;
}
