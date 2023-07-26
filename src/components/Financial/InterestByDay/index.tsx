import * as React from 'react';
import { Form, Card, Input } from '@alifd/next';

export default function () {
    const FormItem = Form.Item;
    const formItemLayout = {
        colSpan: 4,
    };

    const [interestByDay, setInterestByDay] = React.useState<any>({
        deposit: 0, pa: 0, period: 0
    });

    return <Card free>
        <Card.Header
            title="天计收益"
        />
        <Card.Content>
            <Form
                responsive
                labelAlign="top"
            >
                <FormItem {...formItemLayout} label="本金" required requiredMessage="必填" >
                    <Input placeholder="10000" onChange={(v) => {
                        setInterestByDay({ ...interestByDay, deposit: v });
                    }} />
                </FormItem>
                <FormItem {...formItemLayout} label="收益率 % p.a." required requiredMessage="必填">
                    <Input placeholder="3.6" onChange={(v) => {
                        setInterestByDay({ ...interestByDay, pa: v });
                    }} />
                </FormItem>
                <FormItem {...formItemLayout} label="存期（天）">
                    <Input placeholder="15" onChange={(v) => {
                        setInterestByDay({ ...interestByDay, period: v });
                    }} />
                </FormItem>

                <FormItem {...formItemLayout} label="日收益">
                    <Input placeholder="0" value={(interestByDay.deposit * (interestByDay.pa / 100) / 365).toFixed(4)} readOnly />
                </FormItem>
                <FormItem {...formItemLayout} label="存期内合计收益">
                    <Input placeholder="0" value={(interestByDay.deposit * (interestByDay.pa / 100) / 365 * interestByDay.period).toFixed(4)} readOnly />
                </FormItem>
                <FormItem {...formItemLayout} label="存期内本金收益率 %">
                    <Input placeholder="0" value={(interestByDay.pa / 365 * interestByDay.period).toFixed(4)} readOnly />
                </FormItem>

            </Form>
        </Card.Content>
    </Card>
}