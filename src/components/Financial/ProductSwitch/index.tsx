import * as React from 'react';
import { Form, Card, Input } from '@alifd/next';

export default function () {
    const FormItem = Form.Item;
    const formItemLayout = {
        colSpan: 4,
    };

    const [investSwitch, setInvestSwitch] = React.useState<any>({
        original: 0, novel: 0, delay: 0
    });

    return <Card free>
        <Card.Header
            title="产品切换"
        />
        <Card.Content>
            <Form
                responsive
                labelAlign="top"
            >
                <FormItem {...formItemLayout} label="原收益率 % p.a." required requiredMessage="必填">
                    <Input placeholder="2.5" onChange={(v) => {
                        setInvestSwitch({ ...investSwitch, original: v });
                    }} />
                </FormItem>
                <FormItem {...formItemLayout} label="新收益率 % p.a." required requiredMessage="必填">
                    <Input placeholder="3.6" onChange={(v) => {
                        setInvestSwitch({ ...investSwitch, novel: v });
                    }} />
                </FormItem>
                <FormItem {...formItemLayout} label="耽误交易日（天）" required requiredMessage="必填">
                    <Input placeholder="3" onChange={(v) => {
                        setInvestSwitch({ ...investSwitch, delay: v });
                    }} />
                </FormItem>

                <FormItem {...formItemLayout} label="回本日">
                    <Input placeholder="0" value={(investSwitch.original * investSwitch.delay / (investSwitch.novel - investSwitch.original)).toFixed(4)} readOnly />
                </FormItem>
            </Form>
        </Card.Content>
    </Card>
}