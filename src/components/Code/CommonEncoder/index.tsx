import * as React from 'react';
import { Form, Card, Input, Icon } from '@alifd/next';

export default function (props: any) {
    const FormItem = Form.Item;
    const formItemLayout = {
        colSpan: 4,
    };

    const [text, setText] = React.useState<any>({
        raw: '', encoded: '', encoding: true
    });

    return <Card free>
        <Card.Header
            title={props.title}
        />
        <Card.Content>
            <Form
                responsive
                labelAlign="top"
            >
                <FormItem {...formItemLayout} label="编码前">
                    <Input.TextArea placeholder="decoded" rows={6} onChange={(v) => {
                        setText({ raw: v, encoded: props.encoder(v), encoding: true })
                    }} value={text.raw} />
                </FormItem>
                <FormItem {...formItemLayout} style={{ textAlign: 'center' }} label=" ">
                    <Icon type={`arrow-${text.encoding ? 'right' : 'left'}`} />
                </FormItem>
                <FormItem {...formItemLayout} label="编码后">
                    <Input.TextArea placeholder="encoded" rows={6} onChange={(v) => {
                        setText({ raw: props.decoder(v), encoded: v, encoding: false })
                    }} value={text.encoded} />
                </FormItem>
            </Form>
        </Card.Content>
    </Card>
}