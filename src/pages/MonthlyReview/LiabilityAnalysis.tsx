import React, { useMemo } from 'react';
import Decimal from 'decimal.js';
import type { MonthlyWorkbook } from './workbook';
import { productKey } from './batch';
import { debtRatio, liabilityTotals } from './liability-analysis';
import { liabilityGrowthClass, repaymentDate } from './repayment';
import { displayValue } from './display';

const format = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value: number | null) => value === null ? '—' : format.format(value);
const percent = (value: number | null) => value === null ? '—' : (value * 100).toFixed(2) + '%';

interface Props { book: MonthlyWorkbook; invalidKeys: string[]; onViewLiabilities: () => void; }
export default function LiabilityAnalysis({ book, invalidKeys, onViewLiabilities }: Props) {
  const rows = useMemo(() => book.liabilities(), [book]);
  const totals = useMemo(() => liabilityTotals(rows, invalidKeys), [rows, invalidKeys.join('|')]);
  const invalid = new Set(invalidKeys);
  const ratio = debtRatio(totals.balance, invalidKeys.some(key => !key.startsWith('Liabilities:')) ? null : book.value('Analyze', 'O3'));
  const active = rows.filter(row => !invalid.has(productKey(row)) && row.balance > 0).length;
  const ordered = [...rows].sort((a, b) => b.balance - a.balance || a.row - b.row);
  return <section className="mr-panel mr-liability-analysis" aria-label="负债分析">
    <div className="mr-section-heading"><div><h2>负债分析</h2><p>统计全账本负债，金额均为人民币，不受资产或负债表格筛选影响。</p></div><button onClick={onViewLiabilities}>查看负债记录</button></div>
    <div className="mr-return-cards" aria-live="polite">
      <article><span>本期负债总额</span><strong>RMB {money(totals.balance)}</strong><small>上期明细合计 RMB {money(totals.previous)}</small></article>
      <article><span>较上期净增长</span><strong className={liabilityGrowthClass(totals.growth ?? 0)}>RMB {money(totals.growth)}</strong><small>本期负债 − 上期负债；负数表示负债减少</small></article>
      <article><span>资产负债率</span><strong>{percent(ratio)}</strong><small>本期负债 ÷ 家庭总资产</small></article>
      <article><span>有余额的负债账户</span><strong>{active} 个</strong><small>共 {rows.length} 个账户；不计入余额无效的账户</small></article>
    </div>
    {totals.balance === null && <p className="mr-return-note">存在无效负债余额，负债总额、净增长和占比暂不计算。请修正后查看。</p>}
    {ratio === null && totals.balance !== null && <p className="mr-return-note">家庭总资产为零或缺少有效资产金额，暂不计算资产负债率。</p>}
    <h3>账户负债分布</h3>
    {!rows.length ? <p className="mr-return-note">暂无负债账户。</p> : <div className="mr-table-wrap"><table><thead><tr><th>账户</th><th>上期余额</th><th>本期余额</th><th>净增长</th><th>本期负债占比</th><th>还款日</th></tr></thead><tbody>{ordered.map(row => {
      const bad = invalid.has(productKey(row));
      const balance = bad || !Number.isFinite(row.balance) ? null : row.balance;
      const growth = balance === null || !Number.isFinite(row.previous) ? null : new Decimal(balance).minus(row.previous).toNumber();
      const share = debtRatio(balance, totals.balance);
      return <tr key={productKey(row)}><td><strong>{displayValue(row.account)}</strong></td><td>RMB {money(Number.isFinite(row.previous) ? row.previous : null)}</td><td>RMB {money(balance)}</td><td className={liabilityGrowthClass(growth ?? 0)}>{money(growth)}</td><td><div className="mr-debt-share"><span>{percent(share)}</span><div className="mr-track"><span style={{ width: Math.min(100, (share || 0) * 100) + '%', background: '#3577eb' }} /></div></div></td><td>{repaymentDate(row.repayment) || displayValue(row.repayment)}</td></tr>;
    })}</tbody></table></div>}
    <p className="mr-footnote">上期负债取账户明细余额；还款日展示已登记信息，不代表当期应还金额。</p>
  </section>;
}
