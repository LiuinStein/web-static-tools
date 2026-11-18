import * as React from 'react';
import { Card, Form } from '@alifd/next';
import Decimal from 'decimal.js';
import AmountInput from '@/pages/MonthlyReview/AmountInput';
import { rawAmount } from '@/pages/MonthlyReview/amount';

export function calculateDilutedCost(values: string[]) {
    if (values.some(value => !value.trim())) return { message: '请填写全部四项数据。' };
    if (values.some(value => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) {
        return { message: '请输入有效数字。' };
    }
    const [cost, shares, tradeCost, tradeShares] = values.map(value => new Decimal(value));
    if (cost.isNegative() || tradeCost.isNegative() || shares.isNegative()) {
        return { message: '当前成本、当前份额和调仓成本不能为负数。' };
    }
    const totalShares = shares.plus(tradeShares);
    if (totalShares.isNegative()) return { message: '卖出份额不能超过当前份额。' };
    if (totalShares.isZero()) return { message: '调仓后份额为 0，无剩余持仓，无法计算摊薄成本。' };
    const dilutedCost = cost.times(shares).plus(tradeCost.times(tradeShares)).div(totalShares);
    return { cost: dilutedCost.toFixed(4), shares: totalShares.toString(), message: '' };
}

function selectAmount(event: React.SyntheticEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    // Wait for AmountInput to restore its editing value before selecting it.
    requestAnimationFrame(() => {
        if (document.activeElement === input) input.select();
    });
}

export default function DilutedCostCalculator() {
    const [values, setValues] = React.useState(['', '', '', '']);
    const result = calculateDilutedCost(values);
    const labels = ['当前成本', '当前份额', '调仓成本', '调仓份额'];
    return <Card free>
        <Card.Header title="摊薄成本计算器" />
        <Card.Content>
            <p>成本按每份单价填写；调仓份额为正数表示买入，为负数表示卖出。不含手续费。</p>
            <Form responsive labelAlign="top">
                {labels.map((label, index) => <Form.Item key={label} colSpan={6} label={label}>
                    <AmountInput
                        appearance="fusion"
                        aria-label={label}
                        value={values[index]}
                        placeholder={index === 3 ? '正数买入，负数卖出' : '请输入' + label}
                        onFocus={selectAmount}
                        onClick={selectAmount}
                        onChange={event => {
                            const value = rawAmount(event.currentTarget.value);
                            setValues(previous => previous.map((item, i) => i === index ? value : item));
                        }}
                    />
                </Form.Item>)}
                <Form.Item colSpan={12}>
                    <output aria-live="polite">
                        {result.message || <>调仓后摊薄成本：<strong>{result.cost}</strong>　调仓后总份额：{result.shares}</>}
                    </output>
                </Form.Item>
            </Form>
            <p>摊薄成本 =（当前成本 × 当前份额 + 调仓成本 × 调仓份额）÷（当前份额 + 调仓份额）</p>
        </Card.Content>
    </Card>;
}
