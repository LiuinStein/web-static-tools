import React from 'react';
import { Balloon } from '@alifd/next';
import './style.css';

interface Props { children: React.ReactElement; content?: string; }
export default function HoverHint({ children, content }: Props) {
  if (!content) return children;
  return <Balloon.Tooltip v2 autoAdjust autoFocus={false} trigger={React.cloneElement(children, { tabIndex: 0, title: undefined })} triggerType={['hover', 'focus']} align="t" popupProps={{ animation: false }} className="tool-hover-hint">
    {content}
  </Balloon.Tooltip>;
}
