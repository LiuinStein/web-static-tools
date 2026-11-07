import React, { useEffect, useState } from 'react';
import { Dialog } from '@alifd/next';
import AmountInput from './AmountInput';
import { rawAmount } from './amount';
import { BenchmarkMetric, Benchmarks, benchmarkFor, validBenchmark, BENCHMARK_BANDS, benchmarkIntervalLabel } from './benchmarks';
interface Props { visible: boolean; categories: string[]; categoryNames: Record<string, string>; config: Benchmarks; onClose: () => void; onSave: (config: Benchmarks) => void; }
interface Entry { metric: BenchmarkMetric; high: string; middle: string; low: string; }
export default function BenchmarkDialog({ visible, categories, categoryNames, config, onClose, onSave }: Props) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    if (!visible) return;
    setEntries(Object.fromEntries(categories.map(category => {
      const rule = benchmarkFor(config, category);
      return [category, { metric: rule.metric, high: String(rule.high), middle: String(rule.middle), low: String(rule.low) }];
    })));
    setError('');
  }, [visible]);
  const update = (category: string, patch: Partial<Entry>) => { setEntries(current => ({ ...current, [category]: { ...current[category], ...patch } })); setError(''); };
  return <Dialog visible={visible} title="业绩基准" footer={false} onClose={onClose} className="mr-dialog mr-wide-dialog mr-record-dialog mr-benchmark-dialog">
    <p>按产品类型选择不配置、XIRR 或年化 TWR，每种类型仅选一项。阈值按百分比填写，需满足高档 ＞ 中档 ＞ 低档。</p>
    {error && <div className="mr-message error" role="alert">{error}</div>}
    <form onSubmit={event => {
      event.preventDefault();
      const next = { ...config };
      for (const category of categories) {
        const entry = entries[category];
        if (!entry) return;
        if (entry.metric === 'none') { next[category] = { ...benchmarkFor(config, category), metric: 'none' }; continue; }
        const rule = { metric: entry.metric, high: Number(entry.high), middle: Number(entry.middle), low: Number(entry.low) };
        if ([entry.high, entry.middle, entry.low].some(value => !value.trim()) || !validBenchmark(rule)) { setError((categoryNames[category] || category) + '：请填写有效百分比，并确保高档大于中档、中档大于低档。'); return; }
        next[category] = rule;
      }
      try { onSave(next); } catch (e) { setError('保存业绩基准失败：' + e.message); }
    }}>
      <div className="mr-table-wrap"><table><thead><tr><th>产品类型</th><th>评价指标（单选）</th><th>高档</th><th>中档</th><th>低档</th></tr></thead><tbody>{categories.map(category => {
        const entry = entries[category];
        if (!entry) return null;
        const name = categoryNames[category] || category;
        return <tr key={category}><th scope="row">{name}</th><td><div className="mr-benchmark-metrics" role="radiogroup" aria-label={name + ' 业绩基准指标'}>{([['none', '不配置'], ['xirr', 'XIRR'], ['twr', '年化 TWR']] as const).map(([metric, label]) => <label key={metric}><input type="radio" name={'benchmark-' + category} value={metric} checked={entry.metric === metric} onChange={() => update(category, { metric })} />{label}</label>)}</div></td>{(['high', 'middle', 'low'] as const).map((tier, index) => <td key={tier}><div className="mr-benchmark-percent"><AmountInput aria-label={name + ' ' + ['高档', '中档', '低档'][index] + '百分比'} disabled={entry.metric === 'none'} value={entry.metric === 'none' ? '' : entry[tier]} placeholder="—" onFocus={event => event.currentTarget.select()} onChange={event => update(category, { [tier]: rawAmount(event.target.value) })} /><span>%</span></div></td>)}</tr>;
      })}</tbody></table></div>
      <div className="mr-benchmark-legend">{BENCHMARK_BANDS.map(band => <span key={band} className={'mr-performance-' + band}>{benchmarkIntervalLabel(band)}</span>)}</div>
      <p>配置保存在当前浏览器，应用于资产表对应的收益率列；缺失或待核实的收益率不着色。</p>
      <div className="mr-actions"><button type="button" onClick={onClose}>取消</button><button className="primary" type="submit">保存并生效</button></div>
    </form>
  </Dialog>;
}
