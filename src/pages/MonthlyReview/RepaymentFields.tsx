import React from 'react';
import { RepaymentForm } from './repayment';
import { isoDate } from './formula';
interface Props { value: RepaymentForm; onChange: (value: RepaymentForm) => void; disabled: boolean; originalValue?: string | number | boolean | null; }
export default function RepaymentFields({ value, onChange, disabled, originalValue }: Props) {
  const custom = value.customInterval;
  const update = (patch: Partial<RepaymentForm>) => onChange({ ...value, ...patch });
  return <div className="mr-repayment-fields">
    <label className="mr-field"><span>还款方式</span><select aria-label="还款方式" disabled={disabled} value={value.mode} onChange={event => update({ mode: event.target.value as RepaymentForm['mode'] })}>
      <option value="recurring">按月还款</option><option value="once">一次性还清</option><option value="none">不设置</option>{value.original.trim() && <option value="legacy">保留原还款日</option>}
    </select></label>
    {value.mode === 'recurring' && <div className="mr-grid">
      <label className="mr-field"><span>还款日（1–31 日）</span><input aria-label="还款日" type="number" inputMode="numeric" min="1" max="31" step="1" disabled={disabled} placeholder="可留空" value={value.day} onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()} onChange={event => update({ day: event.target.value })} /></label>
      <label className="mr-field"><span>还款间隔</span><select aria-label="还款间隔" disabled={disabled} value={custom ? 'custom' : value.months} onChange={event => update({ months: event.target.value === 'custom' ? '' : event.target.value, customInterval: event.target.value === 'custom' })}><option value="1">每月</option><option value="2">每 2 个月（双月）</option><option value="3">每 3 个月（季度）</option><option value="6">每 6 个月（半年）</option><option value="12">每 12 个月（每年）</option><option value="custom">自定义月份间隔</option></select></label>
      {custom && <label className="mr-field"><span>间隔月数</span><input aria-label="间隔月数" type="number" inputMode="numeric" min="1" step="1" disabled={disabled} value={value.months} onChange={event => update({ months: event.target.value })} /></label>}
    </div>}
    {value.mode === 'once' && <label className="mr-field mr-repayment-date"><span>一次性还清日期</span><input aria-label="一次性还清日期" type="date" required disabled={disabled} value={value.date} onChange={event => update({ date: event.target.value })} /></label>}
    {value.mode === 'legacy' && <p className="mr-repayment-original">原还款日：{typeof originalValue === 'number' ? isoDate(originalValue) || value.original : value.original}</p>}
  </div>;
}
