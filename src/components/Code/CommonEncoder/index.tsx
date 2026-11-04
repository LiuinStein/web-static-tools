import * as React from 'react';
import { Form, Card, Input, Icon } from '@alifd/next';
import { convertInput, EncodingState } from './model';

export default function (props: any) {
    const FormItem = Form.Item;
    const formItemLayout = {
        colSpan: 4,
    };

    const [text, setText] = React.useState<EncodingState>({
        raw: '', encoded: '', encoding: true, error: ''
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
                        setText(convertInput(String(v), true, props.encoder))
                    }} value={text.raw} />
                </FormItem>
                <FormItem {...formItemLayout} style={{ textAlign: 'center' }} label=" ">
                    <Icon type={`arrow-${text.encoding ? 'right' : 'left'}`} />
                </FormItem>
                <FormItem {...formItemLayout} label="编码后">
                    <Input.TextArea placeholder="encoded" rows={6} onChange={(v) => {
                        setText(convertInput(String(v), false, props.decoder))
                    }} value={text.encoded} />
                </FormItem>
            </Form>
            {text.error && <p role="status">{text.error}</p>}
        </Card.Content>
    </Card>
}