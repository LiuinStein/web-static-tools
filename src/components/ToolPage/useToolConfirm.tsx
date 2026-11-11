import React, { useEffect, useRef, useState } from 'react';
import ToolDialog from './ToolDialog';

interface Confirmation { title: string; message: string; confirmLabel?: string; danger?: boolean; }
export default function useToolConfirm() {
  const [request, setRequest] = useState<Confirmation | null>(null);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);
  useEffect(() => () => { pending.current?.(false); pending.current = null; }, []);
  const settle = (confirmed: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setRequest(null);
    resolve?.(confirmed);
  };
  const confirm = (options: Confirmation) => new Promise<boolean>(resolve => {
    // A second action cannot replace the pending confirmation or inherit its answer.
    if (pending.current) { resolve(false); return; }
    pending.current = resolve;
    setRequest(options);
  });
  const confirmationDialog = <ToolDialog visible={request !== null} title={request?.title || '请确认'} size="compact" footer={false} closeMode={['close', 'mask', 'esc']} onClose={() => settle(false)}>
    <p>{request?.message}</p>
    <div className="tool-dialog-actions"><button type="button" onClick={() => settle(false)}>取消</button><button type="button" className={request?.danger ? 'danger' : 'primary'} onClick={() => settle(true)}>{request?.confirmLabel || '确认'}</button></div>
  </ToolDialog>;
  return { confirm, confirmationDialog };
}
