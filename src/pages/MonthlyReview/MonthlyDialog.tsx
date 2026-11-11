import React from 'react';
import { Dialog } from '@alifd/next';
import ToolDialog from '../../components/ToolPage/ToolDialog';

// Compatibility entry for monthly review's feature-specific dialog classes.
export default function MonthlyDialog(props: React.ComponentProps<typeof Dialog>) {
  return ToolDialog({ ...props, overlayProps: {
    ...props.overlayProps,
    wrapperClassName: ['mr-dialog-overlay', props.overlayProps?.wrapperClassName].filter(Boolean).join(' '),
  }});
}
