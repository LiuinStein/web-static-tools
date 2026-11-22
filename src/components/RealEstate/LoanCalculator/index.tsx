import * as React from 'react';
import SegmentedControl from '@/components/SegmentedControl';
import Select from '@/components/Select';
import AmountInput from '@/pages/MonthlyReview/AmountInput';
import { rawAmount } from '@/pages/MonthlyReview/amount';
import type { LoanMode, DownPaymentMode, RepaymentMode } from './model';
import { calculateLoan } from './model';
import './style.css';

const money = (value: number) => value.toLocaleString('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  maximumFractionDigits: 2,
});

interface LoanCalculatorProps {
  homeType: 'new' | 'resale';
  purchasePrice: number;
  homeCount: 'first' | 'second' | 'other';
}

export default function LoanCalculator({ homeType, purchasePrice, homeCount }: LoanCalculatorProps) {
  const [loanMode, setLoanMode] = React.useState<LoanMode>('combined');
  const [repaymentMode, setRepaymentMode] = React.useState<RepaymentMode>('equalPrincipalAndInterest');
  const [downPaymentMode, setDownPaymentMode] = React.useState<DownPaymentMode>('rate');
  const [downPaymentRate, setDownPaymentRate] = React.useState('30');
  const [downPaymentAmount, setDownPaymentAmount] = React.useState('');
  const [years, setYears] = React.useState('20');
  const [fundRate, setFundRate] = React.useState('2.6');
  const [commercialRate, setCommercialRate] = React.useState('3.0');
  const [contributionYears, setContributionYears] = React.useState('5');
  const [applicantType, setApplicantType] = React.useState<'family' | 'individual'>('family');
  const [fundAmount, setFundAmount] = React.useState('1600000');
  const [valuation, setValuation] = React.useState('6000000');
  const [valuationManual, setValuationManual] = React.useState(false);

  React.useEffect(() => {
    if (!valuationManual) setValuation(String(purchasePrice > 0 ? purchasePrice : 0));
  }, [purchasePrice, valuationManual]);

  React.useEffect(() => {
    if (downPaymentMode === 'amount' && downPaymentAmount === '') {
      setDownPaymentAmount(String(Math.round(purchasePrice * 0.3)));
    }
  }, [purchasePrice]);

  const scaleTenThousand = (value: string) => {
    const amount = Number(rawAmount(value));
    if (!Number.isFinite(amount) || amount <= 0) return rawAmount(value);
    return amount < 10000 ? String(amount * 10000) : rawAmount(value);
  };

  const switchDownPaymentMode = (mode: DownPaymentMode) => {
    if (mode === downPaymentMode) return;
    if (mode === 'amount') {
      const amount = downPaymentMode === 'rate'
        ? purchasePrice * (Number(downPaymentRate) || 0) / 100
        : Number(downPaymentAmount) || 0;
      setDownPaymentAmount(String(Math.round(amount)));
    } else {
      const amount = Number(downPaymentAmount) || purchasePrice * 0.3;
      setDownPaymentRate(purchasePrice > 0 ? String(Number((amount / purchasePrice * 100).toFixed(2))) : '30');
    }
    setDownPaymentMode(mode);
  };

  const fundPolicyLimit = React.useMemo(() => {
    const years = Number(contributionYears) || 0;
    if (years <= 0) return 0;
    const second = homeCount === 'second' || homeCount === 'other';
    if (applicantType === 'family') {
      return Math.min(years * 400000, second ? 2000000 : 2400000);
    }
    return Math.min(years * 200000, second ? 1000000 : 1200000);
  }, [applicantType, contributionYears, homeCount]);

  React.useEffect(() => {
    const purchaseValue = homeType === 'resale'
      ? Math.min(purchasePrice, Number(rawAmount(valuation)) || purchasePrice)
      : purchasePrice;
    const downPayment = downPaymentMode === 'rate'
      ? purchaseValue * (Number(downPaymentRate) || 0) / 100
      : Number(rawAmount(downPaymentAmount)) || 0;
    const availableLoan = Math.max(0, purchaseValue - downPayment);
    setFundAmount(String(Math.max(0, Math.min(fundPolicyLimit, availableLoan))));
  }, [
    fundPolicyLimit,
    purchasePrice,
    valuation,
    homeType,
    downPaymentMode,
    downPaymentRate,
    downPaymentAmount,
  ]);

  const result = calculateLoan({
    purchasePrice,
    valuation: homeType === 'resale' ? Number(rawAmount(valuation)) || 0 : purchasePrice,
    downPaymentMode,
    downPaymentRate: Number(downPaymentRate) || 0,
    downPaymentAmount: Number(rawAmount(downPaymentAmount)) || 0,
    years: Number(years),
    mode: loanMode,
    fundRate: Number(fundRate) || 0,
    commercialRate: Number(commercialRate) || 0,
    fundAmount: Number(rawAmount(fundAmount)) || 0,
    fundPolicyLimit: Number(fundPolicyLimit) || 0,
    contributionYears: Number(contributionYears) || 0,
    repaymentMode,
  });

  const amountField = (label: string, value: string, setValue: (next: string) => void, onBlur?: (value: string) => void, wide = false) => (
    <label className={`tool-field loan-field${wide ? ' loan-field-wide' : ''}`}>
      <span>{label}</span>
      <AmountInput
        appearance="native"
        aria-label={label}
        value={value}
        onFocus={event => event.currentTarget.select()}
        onClick={event => event.currentTarget.select()}
        onChange={event => setValue(rawAmount(event.currentTarget.value))}
        onBlur={event => onBlur?.(scaleTenThousand(event.currentTarget.value))}
      />
    </label>
  );

  return <section className="loan-calculator">
    <h2>贷款计算器</h2>
    <div className="salary-layout loan-layout">
      <section className="salary-panel loan-input-panel">
        <h2>贷款参数</h2>
        <div className="tool-fields loan-fields">
          <label className="tool-field loan-field loan-field-wide">
            <span>贷款方式</span>
            <SegmentedControl<LoanMode>
              aria-label="贷款方式"
              value={loanMode}
              onChange={setLoanMode}
              options={[
                { value: 'fund', label: '北京公积金' },
                { value: 'commercial', label: '商贷' },
                { value: 'combined', label: '组合贷' },
              ]}
            />
          </label>

          <label className="tool-field loan-field loan-field-wide">
            <span>还款方式</span>
            <SegmentedControl<RepaymentMode>
              aria-label="还款方式"
              value={repaymentMode}
              onChange={setRepaymentMode}
              options={[
                { value: 'equalPrincipalAndInterest', label: '等额本息' },
                { value: 'equalPrincipal', label: '等额本金' },
              ]}
            />
          </label>

          {homeType === 'resale' && amountField(
            '银行评估价（元）',
            valuation,
            next => { setValuationManual(true); setValuation(next); },
            next => setValuation(scaleTenThousand(next)),
            true,
          )}

          <label className="tool-field loan-field loan-field-wide">
            <span>首付方式</span>
            <SegmentedControl<DownPaymentMode>
              aria-label="首付方式"
              value={downPaymentMode}
              onChange={switchDownPaymentMode}
              options={[
                { value: 'rate', label: '按比例' },
                { value: 'amount', label: '按金额' },
              ]}
            />
          </label>

          {downPaymentMode === 'rate'
            ? <label className="tool-field loan-field">
                <span>首付比例（%）</span>
                <input type="text" inputMode="decimal" value={downPaymentRate}
                  onFocus={event => event.currentTarget.select()}
                  onClick={event => event.currentTarget.select()}
                  onChange={event => /^\d*(?:\.\d*)?$/.test(event.target.value) && setDownPaymentRate(event.target.value)} />
              </label>
            : amountField('首付金额（元）', downPaymentAmount, setDownPaymentAmount, next => setDownPaymentAmount(scaleTenThousand(next)))}

          <label className="tool-field loan-field">
            <span>贷款年限（年）</span>
            <input type="text" inputMode="numeric" value={years}
              onFocus={event => event.currentTarget.select()}
              onClick={event => event.currentTarget.select()}
              onChange={event => /^\d*$/.test(event.target.value) && setYears(event.target.value)} />
          </label>

          {(loanMode === 'fund' || loanMode === 'combined') && <label className="tool-field loan-field">
            <span>公积金贷款利率（%）</span>
            <input type="text" inputMode="decimal" value={fundRate}
              onFocus={event => event.currentTarget.select()}
              onClick={event => event.currentTarget.select()}
              onChange={event => /^\d*(?:\.\d*)?$/.test(event.target.value) && setFundRate(event.target.value)} />
          </label>}

          {(loanMode === 'commercial' || loanMode === 'combined') && <label className="tool-field loan-field">
            <span>商贷利率（%）</span>
            <input type="text" inputMode="decimal" value={commercialRate}
              onFocus={event => event.currentTarget.select()}
              onClick={event => event.currentTarget.select()}
              onChange={event => /^\d*(?:\.\d*)?$/.test(event.target.value) && setCommercialRate(event.target.value)} />
          </label>}

          {loanMode === 'combined' && <>
            <label className="tool-field loan-field">
              <span>申请人类型</span>
              <Select aria-label="申请人类型" value={applicantType} onChange={event => setApplicantType(event.target.value as 'family' | 'individual')}>
                <option value="family">家庭双方都缴存</option>
                <option value="individual">仅一人缴存</option>
              </Select>
            </label>
            <label className="tool-field loan-field">
              <span>连续足额缴存年限（年）</span>
              <input type="text" inputMode="decimal" value={contributionYears}
                onFocus={event => event.currentTarget.select()}
                onClick={event => event.currentTarget.select()}
                onChange={event => /^\d*(?:\.\d*)?$/.test(event.target.value) && setContributionYears(event.target.value)} />
            </label>
            {amountField(
              '公积金贷款额度（元）',
              fundAmount,
              setFundAmount,
              next => setFundAmount(scaleTenThousand(next)),
              true,
            )}
          </>}
        </div>
        {!result.valid &&
          <p className="loan-error" role="alert">
            首付比例不能低于 15%，首付金额不能低于合同成交价的 15%，且首付应小于房屋价格。
            {loanMode === 'combined' && ' 公积金贷款额度不超过政策上限且不超过贷款总额。'}
          </p>}
      </section>

      <section className="salary-results loan-results" aria-live="polite">
        <div className="salary-total">
          <span>{repaymentMode === 'equalPrincipalAndInterest' ? '每月还款（等额本息）' : '首月还款（等额本金）'}</span>
          <strong>{money(result.valid ? result.monthlyPayment : 0)}</strong>
          <div className="loan-result-meta">
            <p><span>贷款总额</span><b>{money(result.valid ? result.loanAmount : 0)}</b></p>
            {repaymentMode === 'equalPrincipal' && result.valid && <p><span>以后每月递减</span><b>{money(result.monthlyDecrease)}</b></p>}
          </div>
        </div>
        <div className="salary-panel">
          <h2>还款概览</h2>
          {[
            ['首付', result.downPayment],
            ['公积金贷款', result.fundAmount],
            ['商业贷款', result.commercialAmount],
            ['贷款本金', result.principal],
            ['利息合计', result.interest],
            ['本息合计', result.totalPayment],
          ].map(([label, amount]) => <div className="salary-line" key={String(label)}>
            <span>{label}</span><b>{money(result.valid ? Number(amount) : 0)}</b>
          </div>)}
        </div>
      </section>
    </div>
  </section>;
}
