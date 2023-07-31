import * as React from 'react';
import { Form, Card, Input, Message, DatePicker } from '@alifd/next';

import moment from 'moment';

export default function () {
    const FormItem = Form.Item;
    const formItemLayout = {
        colSpan: 4,
    };

    const [bondInterest, setBondInterest] = React.useState<any>({
        currentPrice: 0, nominalPrice: 100, nominalPa: 0,
        principal: 0, paymentFrequency: 2, maturityDate: moment(new Date()),
        commissionOnce: 0.08, commissionPa: 0.08, commissionOnceWithRange: [{
            rate: 0.04, min: 2, max: 15
        }]
    });

    const calcDueInterests = (params: any) => {
        // simple interest
        const remainDays = params.maturityDate.diff(params.nextPayDate, 'days');
        const interestPerDayByPiece = params.nominalPrice * params.nominalPa / 100 / 365;
        const remainInterestsByPiece = remainDays * interestPerDayByPiece;

        // commissions
        const remainCommissionPa = (params.nominalPrice * params.commissionPa / 100 / 365) * remainDays;
        const commissionOnceWithRange = params.commissionOnceWithRange
            .map(x => Math.min(x.max, Math.max(x.min, x.rate / 100 * params.principal)))
            .reduce((x, y) => x + y);

        return (remainInterestsByPiece + (params.nominalPrice - params.currentPrice)) * (params.principal / params.nominalPrice)
            - (params.commissionOnce / 100 * params.principal)
            - remainCommissionPa
            - commissionOnceWithRange;
    }

    return <Card free>
        <Card.Header
            title="债券收益"
        />
        <Card.Content>
            <Message
                type="warning"
                title="默认交易费率"
                style={{ marginBottom: 10 }}
            >
                佣金：0.08%/笔
                托管费：0.08% p.a.
                平台费：0.04%/笔（min 2, max 15）
            </Message>
            <Form
                responsive
                labelAlign="top"
            >
                <FormItem {...formItemLayout} label="买入价格" required requiredMessage="必填">
                    <Input placeholder="97.654" onChange={(v) => {
                        setBondInterest({ ...bondInterest, currentPrice: v });
                    }} />
                </FormItem>
                <FormItem {...formItemLayout} label="票面价格" required requiredMessage="必填">
                    <Input value="100" onChange={(v) => {
                        setBondInterest({ ...bondInterest, nominalPrice: v });
                    }} />
                </FormItem>
                <FormItem {...formItemLayout} label="票面收益率 % p.a." required requiredMessage="必填">
                    <Input placeholder="2.5" onChange={(v) => {
                        setBondInterest({ ...bondInterest, nominalPa: v });
                    }} />
                </FormItem>

                <FormItem {...formItemLayout} label="买入本金" required requiredMessage="必填">
                    <Input placeholder='1000' onChange={(v) => {
                        setBondInterest({ ...bondInterest, principal: v });
                    }} />
                </FormItem>
                <FormItem {...formItemLayout} label="派息频率（1年N次）" required requiredMessage="必填">
                    <Input value="2" onChange={(v) => {
                        setBondInterest({ ...bondInterest, paymentFrequency: v });
                    }} />
                </FormItem>
                {/* <FormItem {...formItemLayout} label="下一派息日" required requiredMessage="必填">
                    <DatePicker value={bondInterest.nextPayDate} onChange={(v) => {
                        setBondInterest({ ...bondInterest, nextPayDate: v });
                    }} style={{ width: '100%' }} />
                </FormItem> */}
                <FormItem {...formItemLayout} label="到期时间" required requiredMessage="必填">
                    <DatePicker value={bondInterest.maturityDate} onChange={(v) => {
                        setBondInterest({ ...bondInterest, maturityDate: v });
                    }} style={{ width: '100%' }} />
                </FormItem>

                <FormItem {...formItemLayout} label="到期收益">
                    <Input placeholder="0" value={calcDueInterests(bondInterest).toFixed(4)} readOnly />
                </FormItem>
                <FormItem {...formItemLayout} label="到期年化收益率 % p.a.">
                    <Input placeholder="0" value={(calcDueInterests(bondInterest) / (bondInterest.maturityDate.diff(bondInterest.nextPayDate, 'days') / 365) / bondInterest.principal * 100).toFixed(4)} readOnly />
                </FormItem>
                <FormItem {...formItemLayout} label="每次派息">
                    <Input placeholder="0" value={(bondInterest.nominalPrice * bondInterest.nominalPa / 100 / bondInterest.paymentFrequency) * (bondInterest.principal / bondInterest.nominalPrice)} readOnly />
                </FormItem>
            </Form>
        </Card.Content>
    </Card>
}