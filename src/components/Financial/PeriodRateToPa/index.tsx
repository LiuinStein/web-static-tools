import * as React from 'react';
import { Form, Card, Input, Select } from '@alifd/next';

export default function () {
    const FormItem = Form.Item;
    const formItemLayout = {
        colSpan: 6,
    };

    const [pp2pa, setPp2Pa] = React.useState<any>({
        period: 0, rate: 0
    });

    return <Card free>
        <Card.Header
            title="阶段收益率转年化&日均万元收益"
        />
        <Card.Content>
            <Form
                responsive
                labelAlign="top"
            >
                <FormItem {...formItemLayout} label="时长（天）" required requiredMessage="必填">
                    <Select.AutoComplete
                        onChange={(v) => {
                            setPp2Pa({ ...pp2pa, period: v })
                        }}
                        dataSource={[
                            {
                                label: "预设",
                                children: [
                                    { value: 30, label: "一个月" },
                                    { value: 90, label: "三个月" },
                                    { value: 180, label: "六个月" },
                                    { value: 365, label: "一年" },
                                    { value: 7, label: "7天" },
                                    { value: 14, label: "14天" },
                                    { value: 21, label: "21天" },
                                    { value: 360, label: "360天" },
                                    { value: 60, label: "两个月" },
                                    { value: 270, label: "九个月" },
                                ]
                            }
                        ]}
                        style={{ width: '100%' }}
                    />
                </FormItem>
                <FormItem {...formItemLayout} label="阶段收益率 %" required requiredMessage="必填">
                    <Input placeholder="3.6" onChange={(v) => {
                        setPp2Pa({ ...pp2pa, rate: v })
                    }} />
                </FormItem>

                <FormItem {...formItemLayout} label="年化收益率 % p.a.">
                    <Input placeholder="3.6" value={(pp2pa.rate * 365 / pp2pa.period).toFixed(4)} readOnly />
                </FormItem>
                <FormItem {...formItemLayout} label="日均万元收益">
                    <Input placeholder="3.6" value={(pp2pa.rate / pp2pa.period / 100 * 10000).toFixed(4)} readOnly />
                </FormItem>
            </Form>
        </Card.Content>
    </Card>
}
