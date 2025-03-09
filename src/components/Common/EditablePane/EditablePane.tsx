import React from 'react';
import { DatePicker, Input } from '@alifd/next';

class Props {
    defaultTitle: string
    mode: 'input' | 'date'
    onChange: (value: any) => void
}

class State {
    cellTitle: string
    editable: boolean
}

export default class EditablePane extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            cellTitle: props.defaultTitle,
            editable: false,
        };
    }

    componentWillReceiveProps(nextProps: Props) {
        if (nextProps.defaultTitle !== this.state.cellTitle) {
            this.setState({
                cellTitle: nextProps.defaultTitle,
            });
        }
    }

    render() {
        const { cellTitle, editable } = this.state;

        const onKeyDown = e => {
            const { keyCode } = e;
            if (keyCode > 36 && keyCode < 41) {
                e.stopPropagation();
            }
        }

        const onBlur = e => {
            this.setState({
                editable: false,
                cellTitle: e.target.value
            });
        }

        const onDblClick = () => {
            this.setState({
                editable: true,
            });
        }

        if (editable) {
            switch (this.props.mode) {
                case 'date':
                    return <DatePicker defaultValue={cellTitle} onKeyDown={onKeyDown} onChange={(v: string) => {
                        this.props.onChange(v)
                        this.setState({
                            editable: false,
                            cellTitle: v
                        });
                    }} />
                case 'input':
                default:
                    return <Input autoFocus defaultValue={cellTitle} onKeyDown={onKeyDown} onBlur={onBlur} onChange={this.props.onChange} />
            }
        }

        return <span onDoubleClick={onDblClick}>{cellTitle}</span>;
    }
}