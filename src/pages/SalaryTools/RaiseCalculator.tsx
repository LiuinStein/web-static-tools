import SegmentedControl from '@/components/SegmentedControl';
import React, { useState } from 'react';
import { calculateRaiseAmounts, SalaryInput } from './model';

const money = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (n: number | null) => n === null ? '无法计算（原收入不大于 0）' : `${n.toFixed(2)}%`;

export default function RaiseCalculator({ config, autoBases, separateBonus, configValid }: { config: SalaryInput; autoBases: boolean; separateBonus: boolean; configValid: boolean }) {
  type BonusMode = 'months' | 'amount';
  type RaiseMode = 'percent' | 'salary';
  const [salary, setSalary] = useState<string | null>(null);
  const [bonus, setBonus] = useState<{ mode: BonusMode; value: string | null }>({ mode: 'months', value: null });
  const [nextBonus, setNextBonus] = useState<{ mode: BonusMode; value: string | null }>({ mode: 'months', value: null });
  const [raise, setRaise] = useState('30');
  const [raiseMode, setRaiseMode] = useState<RaiseMode>('percent');
  const currentSalary = salary ?? String(config.salary);
  const monthly = Number(currentSalary);
  const nextSalary = raiseMode === 'percent' ? Math.round(monthly * (1 + Number(raise) / 100) * 100) / 100 : Number(raise);
  const raisePercent = monthly > 0 ? (nextSalary / monthly - 1) * 100 : NaN;
  const compact = (n: number) => String(Number(n.toFixed(8)));
  const currentBonusValue = bonus.value ?? (bonus.mode === 'months' ? compact(config.salary > 0 ? config.bonus / config.salary : 0) : String(config.bonus));
  const currentBonusAmount = bonus.mode === 'months' ? Math.round(monthly * Number(currentBonusValue) * 100) / 100 : Number(currentBonusValue);
  const currentMonths = bonus.mode === 'months' ? Number(currentBonusValue) : monthly > 0 ? currentBonusAmount / monthly : 0;
  const nextBonusValue = nextBonus.value ?? (currentBonusValue.trim() === '' ? '' : compact(nextBonus.mode === 'months' ? currentMonths : nextSalary * currentMonths));
  const nextBonusAmount = nextBonus.mode === 'months' ? Math.round(nextSalary * Number(nextBonusValue) * 100) / 100 : Number(nextBonusValue);
  const validNumber = (value: string, max: number, min = 0) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;
  const validBonus = (value: string, mode: BonusMode) => validNumber(value, mode === 'months' ? 1200 : 100000000);
  const complete = validNumber(currentSalary, 100000000, 0.01) && validNumber(raise, raiseMode === 'percent' ? 10000 : 100000000) && validBonus(currentBonusValue, bonus.mode) && validBonus(nextBonusValue, nextBonus.mode);
  const result = configValid && complete ? calculateRaiseAmounts(monthly, nextSalary, currentBonusAmount, nextBonusAmount, config, autoBases, separateBonus) : null;
  const switchBonusMode = (after: boolean, mode: BonusMode) => {
    const state = after ? nextBonus : bonus;
    if (state.mode === mode) return;
    const value = after ? nextBonusValue : currentBonusValue;
    const amount = after ? nextBonusAmount : currentBonusAmount;
    const base = after ? nextSalary : monthly;
    const converted = value.trim() === '' || !Number.isFinite(amount) || base <= 0 ? value : compact(mode === 'amount' ? amount : amount / base);
    (after ? setNextBonus : setBonus)({ mode, value: after && state.value === null ? null : converted });
  };
  const switchRaiseMode = (mode: RaiseMode) => {
    if (mode === raiseMode) return;
    if (raise.trim() !== '' && Number.isFinite(nextSalary) && Number.isFinite(raisePercent)) setRaise(compact(mode === 'salary' ? nextSalary : raisePercent));
    setRaiseMode(mode);
  };
  const field = (label: string, value: string, set: (value: string) => void, invalid: boolean) => <label className="salary-field salary-field-wide"><span>{label}</span><input type="text" inputMode="decimal" value={value} aria-invalid={invalid} onFocus={e => e.currentTarget.select()} onClick={e => e.currentTarget.select()} onChange={e => { if (/^\d*(?:\.\d*)?$/.test(e.target.value)) set(e.target.value); }} /></label>;

  const bonusField = (after: boolean) => {
    const state = after ? nextBonus : bonus;
    const title = after ? '涨薪后年终奖' : '当前年终奖';
    const value = after ? nextBonusValue : currentBonusValue;
    const amount = after ? nextBonusAmount : currentBonusAmount;
    return <div className="salary-income"><div className="salary-income-heading"><span>{title}</span><SegmentedControl<BonusMode> className="salary-mode" aria-label={`${title}输入模式`} value={state.mode} onChange={mode => switchBonusMode(after, mode)} options={[{ value: 'months', label: '基本工资月数' }, { value: 'amount', label: '直接输入金额' }]} /></div>
      {field(state.mode === 'months' ? `${title}月数（个月基本工资 / 年）` : `${title}（元 / 年）`, value, v => (after ? setNextBonus : setBonus)({ ...state, value: v }), !validBonus(value, state.mode))}
      <p className="salary-conversion">{state.mode === 'months' ? `${value} 个月 × ${after ? '涨薪后' : '当前'}月基本工资` : '全年金额'} = {Number.isFinite(amount) && value.trim() !== '' ? `¥ ${money(amount)}` : '待输入'}</p></div>;
  };

  return <section className="salary-section salary-severance"><h2>涨薪计算器</h2><p className="salary-help">比较涨薪前后含双边公积金的全年税后总收入，同时查看到手现金的变化。</p>
    <div className="salary-layout salary-severance-layout">
      <div className="salary-results"><div className="salary-panel salary-severance-inputs"><h3>涨薪信息</h3><div className="salary-fields">
        {field('当前税前工资（元 / 月）', currentSalary, setSalary, !validNumber(currentSalary, 100000000, 0.01))}
        {bonusField(false)}
        <div className="salary-income"><div className="salary-income-heading"><span>涨薪</span><SegmentedControl<RaiseMode> variant="content" className="salary-mode" aria-label="涨薪输入模式" value={raiseMode} onChange={switchRaiseMode} options={[{ value: 'percent', label: '百分比' }, { value: 'salary', label: '月基本工资' }]} /></div>
          {field(raiseMode === 'percent' ? '涨薪比例（%，例如 30 表示涨薪 30%）' : '涨薪后月基本工资（元 / 月）', raise, setRaise, !validNumber(raise, raiseMode === 'percent' ? 10000 : 100000000) || nextSalary < monthly)}
          <p className="salary-conversion">{Number.isFinite(raisePercent) && raise.trim() !== '' ? `月基本工资涨幅 ${money(raisePercent)}% · 涨薪后月薪 ¥ ${money(nextSalary)}` : '待输入'}</p>
        </div>
        {bonusField(true)}
      </div><p className="salary-help">当前工资和年终奖默认随上方收入联动，可独立修改。涨薪后年终奖默认沿用当前奖金折算的基本工资月数，可切换模式或独立修改。月数模式下奖金随对应月薪变化，金额模式下按填写的全年金额计算；不包含股权收入。</p>
      <button type="button" onClick={() => { setSalary(null); setBonus({ mode: 'months', value: null }); setNextBonus({ mode: 'months', value: null }); setRaise('30'); setRaiseMode('percent'); }}>恢复默认与工资联动</button></div>
        <div className="salary-panel"><h2>测算口径</h2><p className="salary-help">蓝色卡片按含双边公积金的税后总收入计算：涨幅 =（涨薪后税后总收入 − 涨薪前税后总收入）÷ 涨薪前税后总收入。税后总收入 = 到手收入 + 个人及单位公积金入账。涨薪明细中税前涨薪比例按月基本工资变化计算，另列到手收入涨幅；到手收入已扣除个税、个人社保和个人公积金。原收入不大于 0 时不计算对应百分比。</p><p className="salary-help">沿用上方年终奖{separateBonus ? '单独计税' : '并入综合所得'}、社保比例、公积金及专项扣除配置。{autoBases ? '已开启自动基数：涨薪前后分别按各自工资和年终奖折算月均收入，再应用缴费上下限。' : '已关闭自动基数：涨薪前后均使用上方手动填写的申报基数。'}按全年 12 个月同薪比较，不计算年中调薪的过渡年度。</p></div>
      </div>
      <div className="salary-results salary-severance-results" aria-live="polite">
        {!result ? <p role="alert" className="salary-notice">{!configValid ? '请先检查上方社保、公积金及扣除配置。' : '请输入有效数字：当前工资须大于 0，年终奖月数为 0–1200 或直接输入全年金额；涨薪比例为 0–10000%，或输入不低于当前工资的涨薪后月基本工资；月薪及奖金金额均不得超过一亿元。'}</p> : <><div className="salary-total"><span>税后实际涨薪比例 · 含双边公积金</span><strong>{percent(result.totalRate)}</strong>
          <p>税前涨薪 {money(raisePercent)}% · 月均税后总收入增加 ¥ {money((result.after.total - result.before.total) / 12)}</p>
          <div className="salary-total-split">
            <div>涨薪前全年税后总收入 · 含双边公积金<b>¥ {money(result.before.total)}</b></div>
            <div>涨薪后全年税后总收入 · 含双边公积金<b>¥ {money(result.after.total)}</b></div>
            <div>全年税后总收入增加 · 含双边公积金<b>¥ {money(result.after.total - result.before.total)}</b></div>
          </div>
          {result.increase < 0 && <p className="salary-help">当前方案下到手收入减少，可能涉及年终奖单独计税的税档跳变；可调整上方年终奖计税方式进行比较。</p>}
        </div><div className="salary-panel"><h2>涨薪明细</h2>
          <div className="salary-line"><span>税前涨薪比例</span><b>{percent(raisePercent)}</b></div>
          <div className="salary-line"><span>涨薪后税前月薪</span><b>¥ {money(result.nextSalary)}</b></div>
          <div className="salary-line"><span>涨薪前全年个税</span><b>¥ {money(result.before.totalTax)}</b></div>
          <div className="salary-line"><span>涨薪后全年个税</span><b>¥ {money(result.after.totalTax)}</b></div>
          <div className="salary-line"><span>社保增加（个人 / 全年）</span><b>¥ {money((result.after.social - result.before.social) * 12)}</b></div>
          <div className="salary-line"><span>个税增加（全年）</span><b>¥ {money(result.after.totalTax - result.before.totalTax)}</b></div>
          <div className="salary-line"><span>税后涨薪比例 · 全年到手收入</span><b>{percent(result.cashRate)}</b></div>
          <div className="salary-line"><span>涨薪前全年税后到手</span><b>¥ {money(result.before.cash)}</b></div>
          <div className="salary-line"><span>涨薪后全年税后到手</span><b>¥ {money(result.after.cash)}</b></div>
          <div className="salary-line"><span>全年到手增加</span><b>¥ {money(result.increase)}</b></div>
          <div className="salary-line"><span>双边公积金增加（全年）</span><b>¥ {money(result.after.fundAnnual - result.before.fundAnnual)}</b></div>
          <div className="salary-line"><span>税后涨薪比例 · 含双边公积金</span><b>{percent(result.totalRate)}</b></div>
          <div className="salary-line"><span>涨薪前全年税后总收入 · 含双边公积金</span><b>¥ {money(result.before.total)}</b></div>
          <div className="salary-line"><span>涨薪后全年税后总收入 · 含双边公积金</span><b>¥ {money(result.after.total)}</b></div>
          <div className="salary-line"><span>全年税后总收入增加 · 含双边公积金</span><b>¥ {money(result.after.total - result.before.total)}</b></div>
          <p className="salary-help">税后总收入包含到手收入及双边公积金；双边公积金为个人与单位全年缴存额之和。</p>
        </div></>}

      </div>
    </div>
  </section>;
}
