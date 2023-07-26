import * as React from 'react';
import { Form, Card, Input, DatePicker } from '@alifd/next';

export default function () {
    const FormItem = Form.Item;
    const [dateRange, setDateRange] = React.useState<any>([null, null]);

    return (
        <Card free>
            <Card.Header
                title="日期差计算"
            />
            <Card.Content>
                <Form
                    responsive
                    labelAlign="top"
                >
                    <FormItem colSpan={8} label="区间" required>
                        <DatePicker.RangePicker onChange={(v) => {
                            setDateRange(v);
                        }} style={{ width: '100%' }} />
                    </FormItem>

                    <FormItem colSpan={4} label="日期差">
                        <Input placeholder="15" value={dateRange[0] && dateRange[1] ? dateRange[1].diff(dateRange[0], 'days') : ''} readOnly />
                    </FormItem>
                </Form>
            </Card.Content>
        </Card>
    )
}
