import React, { useEffect } from 'react';
import { Balloon } from '@alifd/next';
import '../ToolPage/style.css';
import './style.css';

interface Props {
  children: React.ReactElement;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  message: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
}
export default function ConfirmPopover({ children, visible, onVisibleChange, message, onConfirm, disabled = false }: Props) {
  useEffect(() => {
    if (!visible || disabled) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); onVisibleChange(false);
    };
    document.addEventListener('keydown', closeOnEscape, true);
    return () => document.removeEventListener('keydown', closeOnEscape, true);
  }, [visible, disabled, onVisibleChange]);
  return <Balloon trigger={children} triggerType="click" align="tl" needAdjust animation={false} autoFocus closable={false} visible={visible && !disabled}
    onVisibleChange={next => onVisibleChange(next && !disabled)} className="tool-page tool-confirm-popover"
    popupProps={{ canCloseByEsc: true, canCloseByOutSideClick: true }}>
    <div role="dialog" aria-label="确认清空备注">
      <p>{message}</p>
      <div className="tool-confirm-popover__actions">
        <button type="button" className="tool-button--small" disabled={disabled} onClick={() => onVisibleChange(false)}>返回</button>
        <button type="button" className="tool-button--small tool-button--danger" disabled={disabled} onClick={async () => {
          if (disabled) return;
          onVisibleChange(false); await onConfirm();
        }}>确认清空</button>
      </div>
    </div>
  </Balloon>;
}
