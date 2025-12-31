import * as React from 'react';
import { Form, Card, Input, Table, Button, DatePicker } from '@alifd/next';

import moment from 'moment';
import { calculateTimeWeightedReturn, calculateMoneyWeightedReturn, onlyDate } from '@/utils/financial';

export default function () {
    const FormItem = Form.Item;

    const [dataSource, setDataSource] = React.useState<any[]>([]);

    const [balance, setBalance] = React.useState<any>(0);

    const [result, setResult] = React.useState<any>({});

    React.useEffect(() => {
        setResult({
            shares: calc(),
            xirr: calcXIRR(),
            twr: calcTWR()
        })
    }, [dataSource, balance])

    const calc = () => {
        return dataSource.map((item: any) => item.shares).reduce((p, c) => p + c, 0)
    }

    const calcXIRR = () => {
        if (dataSource.length == 0 || balance == 0) {
            return { mwr: NaN, annualizedMWR: NaN }
        }

        const cashFlows = [
            ...dataSource?.map((item: any) => parseFloat(item.change) * -1),
            0
        ]

        const dates = [
            ...dataSource?.map((item: any) => new Date(item.date)),
            new Date()
        ]

        const initialValue = Math.abs(cashFlows.reduce((a: number, b: number) => a + b));
        const finalValue = parseFloat(balance);
        if (!initialValue || Math.abs(Math.max(initialValue, finalValue) / Math.min(initialValue, finalValue)) > 10) {
            return { mwr: NaN, annualizedMWR: NaN }
        }

        try {
            return calculateMoneyWeightedReturn({
                cashFlows: cashFlows,
                dates: dates,
                finalValue: finalValue,
                maxIterations: 1000,
                tolerance: 1e-8
            });
        } catch (e) {
            console.log("calculateMoneyWeightedReturn", e);
            return { mwr: NaN, annualizedMWR: NaN };
        }
    }

    const calcTWR = () => {
        if (dataSource.length == 0 || balance == 0) {
            return { twr: NaN, annualizedTWR: NaN }
        }

        const numericData = dataSource.map(item => {
            return { date: item.data, change: parseFloat(item.change), shares: parseFloat(item.shares) };
        });
        const portfolioValues = [numericData[0].change];
        const cashFlows = [0];

        for (let i = 1; i < dataSource.length; i++) {
            const change = numericData[i].change;
            const price = change / numericData[i].shares;
            let portfolioValue = change;
            for (let j = 0; j < i; j++) {
                portfolioValue += numericData[j].shares * price;
            }

            portfolioValues.push(portfolioValue);
            cashFlows.push(change);
        }

        portfolioValues.push(parseFloat(balance));
        cashFlows.push(0);

        const years = (onlyDate().getTime() - onlyDate(dataSource[0].date).getTime()) / (365 * 24 * 3600 * 1000);
        try {
            return calculateTimeWeightedReturn({
                portfolioValues: portfolioValues,
                cashFlows: cashFlows,
                annualizationFactor: years * dataSource.length
            });
        } catch (e) {
            console.log("calculateTimeWeightedReturn", e);
            return { twr: NaN, annualizedTWR: NaN };
        }
    }

    return <Card free>
        <Card.Header
            title="XIRR & TWR"
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
                        <Table.Column title="变更份额（仅计算 TWR 时使用）" dataIndex="shares" cell={(value, index) => {
                            return <Input onChange={(v: string) => {
                                dataSource[index].shares = v
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
                    <Input readOnly value={(result?.xirr?.mwr * 100).toFixed(2)} />
                </FormItem>

                <FormItem colSpan={4} label="XIRR % p.a." >
                    <Input readOnly value={(result?.xirr?.annualizedMWR * 100).toFixed(2)} />
                </FormItem>

                <FormItem colSpan={4} label="总计份额" >
                    <Input readOnly value={result?.shares} />
                </FormItem>

                <FormItem colSpan={4} label="TWR %" >
                    <Input readOnly value={(result?.twr?.twr * 100).toFixed(2)} />
                </FormItem>

                <FormItem colSpan={4} label="TWR % p.a." >
                    <Input readOnly value={(result?.twr?.annualizedTWR * 100).toFixed(2)} />
                </FormItem>
            </Form>
        </Card.Content>
    </Card>
}