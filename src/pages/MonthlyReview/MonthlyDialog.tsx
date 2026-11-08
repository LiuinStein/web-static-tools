import React from 'react';
import { Dialog } from '@alifd/next';

// CSS positions the dialog on its first paint. The default JS positioning path
// measures mounted content and can visibly move it after it has appeared.
export default function MonthlyDialog(props: React.ComponentProps<typeof Dialog>) {
  return <Dialog {...props} isFullScreen align="cc cc" animation={false} overlayProps={{
    ...props.overlayProps,
    wrapperClassName: ['mr-dialog-overlay', props.overlayProps?.wrapperClassName].filter(Boolean).join(' '),
  }} />;
}
