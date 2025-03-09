import * as React from 'react';
import { Form, Card, Input, Table, Button, DatePicker } from '@alifd/next';
import moment from 'moment';

export default function () {
    const FormItem = Form.Item;

    const [dataSource, setDataSource] = React.useState<any>([]);

    const [balance, setBalance] = React.useState<any>(0);

    const calc = () => {
        let seeds = 0, denominator = 0;
        for (const item of dataSource) {
            const change = parseFloat(item.change)

            seeds += change
            denominator += moment().diff(moment(item.date), 'days') / 365.0 * change
        }

        return ((parseFloat(balance) - seeds) / denominator * 100).toFixed(4)
    }

    return <Card free>
        <Card.Header
            title="收益率计算"
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
                            return <Input autoFocus defaultValue={0} onChange={(v: string) => {
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
                            change: '0'
                        }])
                    }}>+ 添加</Button>
                </FormItem>

                <FormItem colSpan={6} label="期末结余" required requiredMessage="必填" >
                    <Input placeholder="10000" onChange={(v) => {
                        setBalance(v)
                    }} />
                </FormItem>

                <FormItem colSpan={6} label="平均年化收益率 % p.a." >
                    <Input readOnly value={calc()} />
                </FormItem>
            </Form>
        </Card.Content>
    </Card>
}