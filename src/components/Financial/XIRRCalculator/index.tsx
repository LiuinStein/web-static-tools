import * as React from 'react';
import { Form, Card, Input, Table, Button, DatePicker } from '@alifd/next';

import moment from 'moment';
import { calculateMoneyWeightedReturn } from '@railpath/finance-toolkit';

export default function () {
    const FormItem = Form.Item;

    const [dataSource, setDataSource] = React.useState<any>([]);

    const [balance, setBalance] = React.useState<any>(0);

    const calc = () => {
        if (dataSource.length == 0 || balance == 0) {
            return { mwr: NaN, annualizedMWR: NaN }
        }

        const cashFlows = [
            ...dataSource?.map((item: any) => parseFloat(item.change) * -1),
            0
        ]

        const dates = [
            ...dataSource?.map((item: any) => new Date(new Date(item.date).setHours(0, 0, 0, 0))),
            new Date(new Date().setHours(0, 0, 0, 0) + 1000 * 60 * 60 * 24 * 0.25)  // a year defined by `calculateMoneyWeightedReturn` is 365.25
        ]

        const initialValue = Math.abs(cashFlows.reduce((a: number, b: number) => a + b));
        const finalValue = parseFloat(balance);
        if (!initialValue || Math.abs(Math.max(initialValue, finalValue) / Math.min(initialValue, finalValue)) > 10) {
            return { mwr: NaN, annualizedMWR: NaN }
        }

        return calculateMoneyWeightedReturn({
            cashFlows: cashFlows,
            dates: dates,
            finalValue: finalValue,
            maxIterations: 1000,
            tolerance: 1e-8
        });
    }

    return <Card free>
        <Card.Header
            title="XIRR i.e. Money-Weighted Return (MWR)"
        />

        <Card.Content>
            <Form
                responsive
                labelAlign="top"
            >
                <FormItem colSpan={12} label="" required requiredMessage="必填" >
                    <Table dataSource={dataSource}>
                        <Table.Column title="日期" dataIndex="date" cell={(value, index) => {
                            return <DatePicker defaultValue={moment()} onChange={(v: string) => {
                                dataSource[index].date = v
                                setDataSource([...dataSource])
                            }} />
                        }} />
                        <Table.Column title="变更额" dataIndex="change" cell={(value, index) => {
                            return <Input autoFocus onChange={(v: string) => {
                                dataSource[index].change = v
                                setDataSource([...dataSource])
                            }} />
                        }} />
                        <Table.Column title="操作" dataIndex='operation' cell={(value, index) => {
                            return <>
                                <Button type='normal' text style={{ color: '#f52743' }} onClick={() => {
                                    setDataSource([...dataSource.slice(0, index), ...dataSource.slice(index + 1)])
                                }}>删除</Button>
                            </>
                        }} />
                    </Table>

                    <Button style={{ width: '100%' }} onClick={() => {
                        setDataSource([...dataSource, {
                            date: moment().format('YYYY-MM-DD'),
                        }])
                    }}>+ 添加</Button>
                </FormItem>

                <FormItem colSpan={4} label="期末结余" required requiredMessage="必填" >
                    <Input placeholder="10000" onChange={(v) => {
                        setBalance(v)
                    }} />
                </FormItem>

                <FormItem colSpan={4} label="XIRR %" >
                    <Input readOnly value={(calc().mwr * 100).toFixed(2)} />
                </FormItem>

                <FormItem colSpan={4} label="XIRR % p.a." >
                    <Input readOnly value={(calc().annualizedMWR * 100).toFixed(2)} />
                </FormItem>
            </Form>
        </Card.Content>
    </Card>
}