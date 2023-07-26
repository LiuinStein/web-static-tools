import * as React from 'react';
import { Form, Card, Input, Icon } from '@alifd/next';

export default function () {
    const FormItem = Form.Item;
    const formItemLayout = {
        colSpan: 4,
    };

    const [pa10kPerDay, setPa10kPerDay] = React.useState<any>({
        pa: 0, tenK: 0
    });

    return <Card free>
        <Card.Header
            title="日均万元收益转年化收益率"
        />
        <Card.Content>
            <Form
                responsive
                labelAlign="top"
            >
                <FormItem {...formItemLayout} label="日均万元收益" required requiredMessage="必填">
                    <Input placeholder="2.5" onChange={(v) => {
                        setPa10kPerDay({ ...pa10kPerDay, tenK: v });
                    }} />
                </FormItem>
                <FormItem {...formItemLayout} style={{ textAlign: 'center' }} label=" ">
                    <Icon type="arrow-right" />
                </FormItem>
                <FormItem {...formItemLayout} label="收益率 % p.a." required requiredMessage="必填">
                    <Input placeholder="3.6" value={(pa10kPerDay.tenK * 365 / 10000 * 100).toFixed(4)} readOnly />
                </FormItem>

                <FormItem {...formItemLayout} label="收益率 % p.a." required requiredMessage="必填">
                    <Input placeholder="3.6" onChange={(v) => {
                        setPa10kPerDay({ ...pa10kPerDay, pa: v });
                    }} />
                </FormItem>
                <FormItem {...formItemLayout} style={{ textAlign: 'center' }} label=" ">
                    <Icon type="arrow-right" />
                </FormItem>
                <FormItem {...formItemLayout} label="日均万元收益" required requiredMessage="必填">
                    <Input placeholder="2.5" value={(pa10kPerDay.pa / 100 * 10000 / 365).toFixed(4)} readOnly />
                </FormItem>
            </Form>
        </Card.Content>
    </Card>
}
