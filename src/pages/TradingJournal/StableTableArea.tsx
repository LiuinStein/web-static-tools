import React, { useLayoutEffect, useRef, useState } from 'react';

interface Props {
  isUnfiltered: boolean;
  isEmpty: boolean;
  baseline: React.ReactNode;
  empty: React.ReactNode;
  children: React.ReactNode;
}

// Measure intrinsic content, not the minimum-height container, so the floor can
// shrink after records are removed and adapt to new data, fonts and viewport widths.
export default function StableTableArea({ isUnfiltered, isEmpty, baseline, empty, children }: Props) {
  const actual = useRef<HTMLDivElement>(null);
  const reference = useRef<HTMLDivElement>(null);
  const emptyReference = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const full = isUnfiltered ? actual.current?.firstElementChild : reference.current;
    const blank = emptyReference.current;
    if (!full || !blank) return undefined;
    const measure = () => {
      const next = Math.ceil(Math.max(full.getBoundingClientRect().height, blank.getBoundingClientRect().height));
      setHeight(previous => previous === next ? previous : next);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(full);
    observer?.observe(blank);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [isUnfiltered, baseline, empty, children]);
  return (
    <div className={`j-stable-table${isEmpty ? ' is-empty' : ''}`} style={{ minHeight: height }}>
      <div className="j-stable-table-content" ref={actual} style={isEmpty ? { minHeight: height } : undefined}>{children}</div>
      {!isUnfiltered && <div className="j-table-reference" aria-hidden="true" ref={reference}>{baseline}</div>}
      <div className="j-table-reference" aria-hidden="true" ref={emptyReference}>{empty}</div>
    </div>
  );
}
