import React, { forwardRef } from 'react';
import { Select as FusionSelect } from '@alifd/next';
import './style.css';

// Consumers can size/place the control, but arrow geometry belongs to this component.
export type SelectLayoutStyle = Pick<React.CSSProperties,
  'width' | 'minWidth' | 'maxWidth' | 'margin' | 'marginTop' | 'marginRight' |
  'marginBottom' | 'marginLeft' | 'display' | 'flex' | 'flexGrow' | 'flexShrink' |
  'alignSelf' | 'gridColumn'>;
export type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'style'> & { style?: SelectLayoutStyle };
const arrowStyle: React.CSSProperties = {
  appearance: 'none',
  WebkitAppearance: 'none',
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='m3 4.5 3 3 3-3' stroke='%23666' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  backgroundSize: '12px 12px',
  paddingRight: 36,
  textOverflow: 'ellipsis',
};

// Keep the native element: labels, form submission, optgroups, events and keyboard
// navigation retain their existing browser behavior. Fixed styles win over page CSS.
const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, style, multiple, size, ...props }, ref) {
  const dropdown = !multiple && (!size || size === 1);
  return <select {...props} ref={ref} multiple={multiple} size={size}
    className={['app-select', className].filter(Boolean).join(' ')}
    style={{ ...style, ...(dropdown ? arrowStyle : {}) }} />;
});
export default Select;

type CompactProps = Omit<React.ComponentProps<typeof FusionSelect>, 'style' | 'hasArrow'> & { style?: SelectLayoutStyle };
// Fusion handles rich option labels, source icons, callbacks, popup and keyboard
// behavior. The existing addon appearance is owned here rather than by a tool page.
export const CompactSelect = forwardRef<React.ElementRef<typeof FusionSelect>, CompactProps>(function CompactSelect({ className, ...props }, ref) {
  return <FusionSelect {...props} ref={ref} hasArrow={false}
    className={['app-select--compact', className].filter(Boolean).join(' ')} />;
});

type AutoCompleteProps = Omit<React.ComponentProps<typeof FusionSelect.AutoComplete>, 'style'> & { style?: SelectLayoutStyle };
// Preserve free input, preset groups, filtering and the library's original arrow policy.
export const SelectAutoComplete = forwardRef<React.ElementRef<typeof FusionSelect.AutoComplete>, AutoCompleteProps>(function SelectAutoComplete({ className, ...props }, ref) {
  return <FusionSelect.AutoComplete {...props} ref={ref}
    className={['app-select--autocomplete', className].filter(Boolean).join(' ')} />;
});
