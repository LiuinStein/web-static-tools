import React from 'react';
import { Dialog } from '@alifd/next';

export type ToolDialogProps = React.ComponentProps<typeof Dialog> & { size?: 'normal' | 'wide' | 'compact' };

// Use CSS placement on first paint instead of measuring and moving visible content.
// The tool-dialog root carries the shared page tokens even when rendered in a portal.
export default function ToolDialog({ size = 'normal', ...props }: ToolDialogProps) {
  return <Dialog {...props} className={['tool-page', 'tool-dialog', `tool-dialog--${size}`, props.className].filter(Boolean).join(' ')} isFullScreen align="cc cc" animation={false} overlayProps={{
    ...props.overlayProps,
    wrapperClassName: ['tool-dialog-overlay', props.overlayProps?.wrapperClassName].filter(Boolean).join(' '),
  }} />;
}
