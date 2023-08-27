import * as React from 'react';
import { Form, Card, Input, Message, Select } from '@alifd/next';
import { calcualteExchangeFee } from '@/utils/financial';

export default function () {
    const FormItem = Form.Item;
    const formItemLayout = {
        colSpan: 4,
    };

    const [stockCommission, setStockCommission] = React.useState<any>({
        unitPrice: 0, quantity: 100, commissionFree: false,
        exchangeFees: [
            { category: 'futu', perTrans: true, target: 'quantity', chargeBy: 'rate', rate: 0.0049, min: 0.99 },  // 佣金
            { category: 'futu', perTrans: true, target: 'quantity', chargeBy: 'rate', rate: 0.005, min: 1 },  // 固定式平台使用费
            { category: 'nyse', perTrans: true, target: 'quantity', chargeBy: 'rate', rate: 0.003 },  // 交收费
            { category: 'nyse', perTrans: false, chargeBy: 'rate', rate: 0.000008, min: 0.01 },  // 证监会规费
            { category: 'nyse', perTrans: false, target: 'quantity', chargeBy: 'rate', rate: 0.000145, min: 0.01, max: 7.27 },  // 交易活动费
        ]
    });

    return <Card free>
        <Card.Header
            title="美股交易费用"
        />
        <Card.Content>
            <Message
                type="warning"
                title="默认交易费率"
                style={{ marginBottom: 10 }}
            >
                佣金：0.0049每股（min 3）；
                平台费：0.005每股（min 1）；
                <a href='https://www.futufin.com/cn/commissionnew?market=hk&lang=zh-cn'>交易所费用</a>
            </Message>
            <Form
                responsive
                labelAlign="top"
            >
                <FormItem {...formItemLayout} label="股价" required requiredMessage="必填">
                    <Input placeholder="89.82" onChange={(v) => {
                        setStockCommission({ ...stockCommission, unitPrice: Number(v) })
                    }} />
                </FormItem>
                <FormItem {...formItemLayout} label="股数" required requiredMessage="必填">
                    <Input value={stockCommission.quantity} onChange={(v) => {
                        setStockCommission({ ...stockCommission, quantity: Number(v) })
                    }} />
                </FormItem>
                <FormItem {...formItemLayout} label="免佣" required requiredMessage="必填">
                    <Select defaultValue={"0"} onChange={(v) => {
                        setStockCommission({ ...stockCommission, commissionFree: v === '1' })
                    }} style={{ width: '100%' }}>
                        <Select.Option value="1">是</Select.Option>
                        <Select.Option value="0">否</Select.Option>
                    </Select>
                </FormItem>

                {(() => {
                    const fee = calcualteExchangeFee(stockCommission.unitPrice, stockCommission.quantity, stockCommission.commissionFree ? stockCommission.exchangeFees.slice(1) : stockCommission.exchangeFees);
                    const totalFee: any = Object.values(fee).reduce((accumulator: any, currentValue: any) => accumulator.charged + currentValue.charged);

                    return <>
                        <FormItem {...formItemLayout} label="回本股价（双向）">
                            <Input value={(totalFee / stockCommission.quantity + stockCommission.unitPrice).toFixed(3)} readOnly />
                        </FormItem>
                        <FormItem {...formItemLayout} label="合计交易费（双向）">
                            <Input value={totalFee.toFixed(2)} readOnly />
                        </FormItem>
                        <FormItem {...formItemLayout} label="费用率（双向）">
                            <Input value={((fee['futu']?.chargedRate + fee['nyse']?.chargedRate) * 100).toFixed(2)} readOnly />
                        </FormItem>

                        <FormItem {...formItemLayout} label="富途费用（单向）">
                            <Input value={(fee['futu']?.charged / 2).toFixed(2)} readOnly />
                        </FormItem>
                        <FormItem {...formItemLayout} label="交易所费用（平均）">
                            <Input value={(fee['nyse']?.charged / 2).toFixed(2)} readOnly />
                        </FormItem>
                        <FormItem {...formItemLayout} label="费用率（平均）">
                            <Input value={((fee['futu']?.chargedRate + fee['nyse']?.chargedRate) * 100 / 2).toFixed(2)} readOnly />
                        </FormItem>
                    </>
                })()}
            </Form>
        </Card.Content>
    </Card>
}