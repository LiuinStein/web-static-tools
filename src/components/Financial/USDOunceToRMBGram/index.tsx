import * as React from 'react';
import { Form, Card, Input, Icon } from '@alifd/next';

export default function () {
    const FormItem = Form.Item;
    const formItemLayout = {
        colSpan: 4,
    };

    const [unitPrice, setUnitPrice] = React.useState<any>({
        currencyExchangeRate: 7.0, usdPerOunce: 0, rmbPerGram: 0
    });

    const ounce2gram = 31.1034768;

    return <Card free>
        <Card.Header
            title="美元每盎司与人民币每克互转"
        />
        <Card.Content>
            <Form
                responsive
                labelAlign="top"
            >
                <FormItem colSpan={12} label="美元兑人民币汇率（1美元=）" required requiredMessage="必填">
                    <Input value={unitPrice.currencyExchangeRate} onChange={(v) => {
                        setUnitPrice({ ...unitPrice, currencyExchangeRate: v });
                    }} />
                </FormItem>

                <FormItem {...formItemLayout} label="美元每盎司" required requiredMessage="必填">
                    <Input placeholder="1946.7" onChange={(v) => {
                        setUnitPrice({ ...unitPrice, usdPerOunce: v });
                    }} />
                </FormItem>
                <FormItem {...formItemLayout} style={{ textAlign: 'center' }} label=" ">
                    <Icon type={`arrow-right`} />
                </FormItem>
                <FormItem {...formItemLayout} label="人民币每克" required requiredMessage="必填">
                    <Input value={(unitPrice.usdPerOunce * unitPrice.currencyExchangeRate / ounce2gram).toFixed(2)} readOnly />
                </FormItem>

                <FormItem {...formItemLayout} label="人民币每克" required requiredMessage="必填">
                    <Input placeholder="459.6" onChange={(v) => {
                        setUnitPrice({ ...unitPrice, rmbPerGram: v });
                    }} />
                </FormItem>
                <FormItem {...formItemLayout} style={{ textAlign: 'center' }} label=" ">
                    <Icon type={`arrow-right`} />
                </FormItem>
                <FormItem {...formItemLayout} label="美元每盎司" required requiredMessage="必填">
                    <Input value={(unitPrice.rmbPerGram * ounce2gram / unitPrice.currencyExchangeRate).toFixed(2) } readOnly />
                </FormItem>
            </Form>
        </Card.Content>
    </Card>
}