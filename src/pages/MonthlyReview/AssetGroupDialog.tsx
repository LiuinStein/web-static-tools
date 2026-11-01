import React, { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@alifd/next';
import { MonthlyWorkbook } from './workbook';
import { NewAssetGroupValues } from './product-entry';

const initial = { member: '本人', currency: 'RMB', category: 'Debt Fund', account: '__new__', newMember: '', newCurrency: '', newCategory: '', newAccount: '', name: '', balance: '0', rate: '' };
interface Props {
  visible: boolean; busy: boolean; book: MonthlyWorkbook | null; error: string;
  categoryNames: Record<string, string>; onClose: () => void; onSave: (values: NewAssetGroupValues) => void;
}
export default function AssetGroupDialog({ visible, busy, book, error, categoryNames, onClose, onSave }: Props) {
  const [form, setForm] = useState(initial);
  useEffect(() => { if (visible) setForm(initial); }, [visible]);
  const products = useMemo(() => visible ? book?.products() || [] : [], [book, visible]);
  const options = {
    member: book?.members().map(m => m.member) || ['本人', 'WTH'],
    currency: book?.currencyCodes() || ['RMB', 'USD', 'HKD'],
    account: [...new Set(products.map(p => p.account))],
    category: [...new Set([...Object.keys(categoryNames), ...products.map(p => p.category)])],
  };
  const value = (key: 'member' | 'currency' | 'category' | 'account') => (form[key] === '__new__' ? form[`new${key[0].toUpperCase()}${key.slice(1)}`] : form[key]).trim();
  const currency = value('currency').toUpperCase(), needsRate = currency && !options.currency.includes(currency) && currency !== 'RMB';
  const update = (key: string, text: string) => setForm(current => ({ ...current, [key]: text }));
  const selectAll = (event: React.SyntheticEvent<HTMLInputElement>) => event.currentTarget.select();
  const choice = (label: string, key: 'member' | 'currency' | 'category' | 'account', custom: string) => <React.Fragment key={key}>
    <label className="mr-field"><span>{label}</span><select aria-label={`分组${label}`} value={form[key]} disabled={busy} onChange={e => update(key, e.target.value)}>{options[key].map(option => <option key={option} value={option}>{key === 'category' ? categoryNames[option] || option : option}</option>)}<option value="__new__">＋ 新增{label}</option></select></label>
    {form[key] === '__new__' && <label className="mr-field"><span>{custom}</span><input aria-label={custom} required disabled={busy} value={form[`new${key[0].toUpperCase()}${key.slice(1)}`]} maxLength={key === 'currency' ? 8 : 100} onChange={e => update(`new${key[0].toUpperCase()}${key.slice(1)}`, key === 'currency' ? e.target.value.toUpperCase() : e.target.value)} /></label>}
  </React.Fragment>;
  return <Dialog visible={visible} title="新增分组与资产" footer={false} onClose={onClose} className="mr-dialog mr-product-dialog">
    {error && <div className="mr-message error" role="alert">{error}</div>}
    <p>选择已有选项或新增成员、币种、账户及产品类型。保存时必须同时创建一条资产记录。</p>
    <form onSubmit={event => {
      event.preventDefault(); if (!book) return;
      const enteredCategory = value('category'), category = Object.keys(categoryNames).find(key => categoryNames[key] === enteredCategory) || enteredCategory;
      onSave({ member: value('member'), currency, category, account: value('account'), name: form.name, balance: form.balance.trim() === '' ? NaN : Number(form.balance), rate: needsRate ? Number(form.rate) : undefined });
    }}><div className="mr-grid">
      {choice('成员', 'member', '新成员名称')}{choice('币种', 'currency', '新币种代码')}
      {needsRate && <label className="mr-field"><span>{currency} → RMB</span><input aria-label="新币种兑人民币汇率" required disabled={busy} type="number" min="0.00000001" step="any" value={form.rate} onFocus={selectAll} onClick={selectAll} onChange={e => update('rate', e.target.value)} /></label>}
      {choice('账户', 'account', '新账户名称')}{choice('产品类型', 'category', '新产品类型')}
      <label className="mr-field"><span>产品名称（留空使用账户名）</span><input aria-label="分组产品名称" disabled={busy} value={form.name} placeholder={value('account') || '默认使用账户名'} onChange={e => update('name', e.target.value)} /></label>
      <label className="mr-field"><span>上期余额</span><input aria-label="分组上期余额" readOnly value="0" /></label>
      <label className="mr-field"><span>本期余额</span><input aria-label="分组本期余额" required disabled={busy} type="number" min="0" step="any" value={form.balance} onFocus={selectAll} onClick={selectAll} onChange={e => update('balance', e.target.value)} /></label>
    </div><p className="mr-footnote">上期余额固定为 0，初始净投入按本期余额建立。保存后可继续编辑净投入及买卖记录。新成员会增加资产与 XIRR 工作表，新币种按原样式增加分区，并参与家庭资产合计。</p>
    <div className="mr-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy || !book}>创建分组与资产</button></div></form>
  </Dialog>;
}
