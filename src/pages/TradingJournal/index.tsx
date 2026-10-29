import React, { useEffect, useRef, useState } from 'react';
import { Button, Dialog } from '@alifd/next';
import PageHeader from '@/components/PageHeader';
import {
  Trade,
  TradeChange,
  calculateFee,
  mergeTrades,
  sameTrade,
  queueChange,
  visibleTrades,
  today,
  validateTrade,
} from './model';
import { DriveConfig, OneDriveJournal } from './onedrive';
import { exportTrades } from './workbook';
import { oneDriveConfig } from './config';
import './style.css';

interface Cache {
  remote: Trade[];
  pending: Trade[];
  changes?: TradeChange[];
  lastSync: string;
}
const settingsKey = 'trading-journal:settings:v1';
const localKey = 'trading-journal:local:v1';
function readJSON(key: string, fallback: any): any {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') || fallback;
  } catch {
    return fallback;
  }
}
const emptyCache: Cache = { remote: [], pending: [], lastSync: '' };
const blank = () => ({
  date: today(),
  type: '股票' as Trade['type'],
  code: '',
  name: '',
  stance: '看多' as Trade['stance'],
  direction: '买入' as Trade['direction'],
  amount: '',
  price: '',
  shares: '',
  fee: '0',
  reason: '',
});
const number = (value: number) => value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export default function TradingJournal() {
  const settings = useRef(readJSON(settingsKey, { config: oneDriveConfig }));
  const [config, setConfig] = useState<DriveConfig>(settings.current.config);
  const [cache, setCache] = useState<Cache>(() => readJSON(localKey, emptyCache));
  const [cacheKey, setCacheKey] = useState(localKey);
  const [drive, setDrive] = useState<OneDriveJournal | null>(null);
  const [account, setAccount] = useState('');
  const [draft, setDraft] = useState(blank);
  const [editing, setEditing] = useState<Trade | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Trade | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('全部');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const formRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const all = visibleTrades(cache.remote, cache.pending, cache.changes || []);
  const filtered = all.filter(
    (trade) =>
      (filter === '全部' || trade.type === filter) &&
      `${trade.code} ${trade.name} ${trade.reason}`.toLowerCase().includes(search.toLowerCase()),
  );
  const automaticFee = draft.type === '股票' && draft.shares !== '';
  const fee = automaticFee
    ? calculateFee(Number(draft.amount), Number(draft.price), Number(draft.shares))
    : Number(draft.fee);
  const known = all.find(
    (trade) => trade.type === draft.type && trade.code.toLowerCase() === draft.code.trim().toLowerCase(),
  );
  const totalFees = all.reduce((sum, trade) => sum + trade.fee, 0);
  let syncLabel = '本机模式';
  const pendingCount = new Set([
    ...cache.pending.map((trade) => trade.id),
    ...(cache.changes || []).map((change) => change.id),
  ]).size;
  if (drive) syncLabel = pendingCount ? `${pendingCount} 条待同步` : '已同步';
  let saveLabel = drive ? '保存并同步到 OneDrive' : '保存到本机';
  if (editing) saveLabel = drive ? '保存修改并同步到 OneDrive' : '保存修改';
  const connectionLabel = drive ? syncLabel : '仅本机保存';
  const stanceStyles = { 看多: 'bull', 看空: 'bear', 平仓: 'flat' };
  useEffect(() => {
    let cancelled = false;
    const saved = settings.current;
    if (saved.config.clientId && saved.accountId) {
      run(async () => {
        const service = new OneDriveJournal(saved.config);
        const user = await service.restore(saved.accountId);
        if (!user || cancelled) return;
        const key = `trading-journal:cloud:v1:${saved.config.clientId}:${user.homeAccountId}:${service.config.path}`;
        const local = readJSON(key, emptyCache) as Cache;
        const remote = await service.read();
        if (cancelled) return;
        persist({ ...local, remote, lastSync: new Date().toISOString() }, key);
        setCacheKey(key);
        setDrive(service);
        setAccount(user.username || user.name || 'Microsoft 账户');
      });
    }
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!drive) return undefined;
    const refresh = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) run(() => synchronize(cacheRef.current));
    };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => {
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.clearInterval(timer);
    };
  }, [drive, cacheKey]);
  function persist(value: Cache, key = cacheKey) {
    localStorage.setItem(key, JSON.stringify(value));
    setCache(value);
  }
  function updateAsset(type: Trade['type'], code: string) {
    const existing = all.find((trade) => trade.type === type && trade.code.toLowerCase() === code.trim().toLowerCase());
    setDraft({ ...draft, type, code, name: existing ? existing.name : '' });
  }
  async function synchronize(current = cache) {
    if (!drive) throw new Error('请先连接 OneDrive');
    const stored = readJSON(cacheKey, current) as Cache;
    const pending = mergeTrades(current.pending, stored.pending);
    const changes = stored.changes || [];
    const remote = await drive.sync(pending, changes);
    const uploadedOperations = new Set(changes.map((change) => change.operationId));
    const latest = readJSON(cacheKey, current) as Cache;
    persist({
      remote,
      pending: latest.pending.filter((trade) => !pending.some((uploaded) => sameTrade(trade, uploaded))),
      changes: (latest.changes || []).filter((change) => !uploadedOperations.has(change.operationId)),
      lastSync: new Date().toISOString(),
    });
    setNotice('已同步到 OneDrive，Excel 文件已更新。');
  }
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (err) {
      setError(err.message || '操作失败，请重试');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      const trade: Trade = {
        id: editing ? editing.id : crypto.randomUUID(),
        date: draft.date,
        type: draft.type,
        code: draft.code.trim().toUpperCase(),
        name: (known && !editing ? known.name : draft.name).trim(),
        stance: draft.stance,
        direction: draft.direction,
        amount: Number(draft.amount),
        price: Number(draft.price),
        shares: draft.shares === '' ? undefined : Number(draft.shares),
        fee,
        reason: draft.reason.trim(),
      };
      validateTrade(trade);
      const stored = readJSON(cacheKey, cache) as Cache;
      let next = { ...stored, pending: stored.pending };
      if (editing) next = { ...stored, changes: queueChange(stored.remote, stored.pending, stored.changes || [], editing, trade) };
      else next.pending = mergeTrades(stored.pending, [trade]);
      persist(next);
      setEditing(null);
      setDraft(blank());
      if (drive) {
        try {
          await synchronize(next);
        } catch (err) {
          throw new Error(`记录已保存到本机，云端未更新：${err.message}。请点击“立即同步”重试。`);
        }
      } else setNotice('记录已保存到本机。当前尚未连接 OneDrive，此记录不会自动出现在其他设备。');
    });
  }
  async function connect() {
    await run(async () => {
      const service = new OneDriveJournal(config);
      const user = await service.connect();
      const key = `trading-journal:cloud:v1:${config.clientId}:${user.homeAccountId}:${service.config.path}`;
      const saved = readJSON(key, emptyCache) as Cache;
      const remote = await service.read();
      localStorage.setItem(settingsKey, JSON.stringify({ config: service.config, accountId: user.homeAccountId }));
      persist({ ...saved, remote, lastSync: new Date().toISOString() }, key);
      setCacheKey(key);
      setEditing(null);
      setDrive(service);
      setAccount(user.username || user.name || 'Microsoft 账户');
      setConfig(service.config);
      setShowSettings(false);
      setDraft(blank());
      setNotice('已加载该账户的云端日记。本机独立日记仍保留在本机，未自动上传。');
    });
  }
  function startNew() {
    setEditing(null);
    setDraft(blank());
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function startEdit(trade: Trade) {
    setEditing(trade);
    setDraft({
      date: trade.date,
      type: trade.type,
      code: trade.code,
      name: trade.name,
      stance: trade.stance,
      direction: trade.direction,
      amount: String(trade.amount),
      price: String(trade.price),
      shares: trade.shares === undefined ? '' : String(trade.shares),
      fee: String(trade.fee),
      reason: trade.reason,
    });
    setError('');
    setNotice('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function removeTrade(trade: Trade) {
    await run(async () => {
      const stored = readJSON(cacheKey, cache) as Cache;
      const changes = queueChange(stored.remote, stored.pending, stored.changes || [], trade);
      const next = { ...stored, changes };
      persist(next);
      setDeleteTarget(null);
      if (editing?.id === trade.id) {
        setEditing(null);
        setDraft(blank());
      }
      if (drive) {
        try {
          await synchronize(next);
        } catch (err) {
          throw new Error(`本机已删除，云端删除尚未同步：${err.message}。请点击“立即同步”重试。`);
        }
      } else setNotice('交易记录已从本机日记删除。');
    });
  }
  const field = (key: keyof typeof draft, value: string) => setDraft({ ...draft, [key]: value });
  return (
    <div className="journal">
      <PageHeader title="交易日记" />
      <div className="journal-heading">
        <p>记录股票与基金的交易信息、交易原因，使用 OneDrive 同步 Excel。</p>
        <Button type="primary" disabled={busy} onClick={startNew}>
          ＋ 记一笔交易
        </Button>
      </div>
      <section className={`journal-sync ${drive ? 'connected' : ''}`}>
        <div className="journal-cloud">☁</div>
        <div className="journal-sync-copy">
          <strong>{drive ? 'OneDrive 已连接' : '连接 OneDrive，让记录随你同行'}</strong>
          <span>
            {drive ? `${account} · /${drive.config.path}` : '使用你自己的 Excel 文件，在手机与电脑之间同步交易记录。'}
          </span>
        </div>
        <div className="journal-sync-actions">
          <span className={`journal-dot ${drive ? 'online' : ''}`}>{busy ? '正在处理…' : connectionLabel}</span>
          <Button
            className="j-btn"
            disabled={busy}
            type="normal"
            onClick={() => (drive ? run(() => synchronize()) : setShowSettings(true))}
          >
            {drive ? '立即同步' : '连接 OneDrive'}
          </Button>
          <button className="j-icon-btn" aria-label="OneDrive 同步设置" onClick={() => setShowSettings(!showSettings)}>
            ⚙
          </button>
        </div>
      </section>
      {showSettings && (
        <section className="j-panel journal-settings">
          <div>
            <div className="j-section-heading">
              <h2>OneDrive 同步设置</h2>
              <button className="j-icon-btn" aria-label="关闭设置" onClick={() => setShowSettings(false)}>
                ×
              </button>
            </div>
            <p className="j-help">
              通过 Microsoft 登录授权读写文件，不需要密码或客户端密钥。首次使用需注册支持个人账户的 SPA
              应用，并将当前网址的源地址和路径（不含 #）设为重定向 URI。客户端 ID 也可在 config.ts 配置文件中填写。
            </p>
            <label className="j-field">
              应用客户端 ID
              <input
                value={config.clientId}
                disabled={!!drive || busy}
                placeholder="Microsoft Entra 应用的客户端 ID"
                onChange={(e) => setConfig({ ...config, clientId: e.target.value })}
              />
            </label>
            <label className="j-field">
              Excel 文件路径
              <input
                value={config.path}
                disabled={!!drive || busy}
                onChange={(e) => setConfig({ ...config, path: e.target.value })}
              />
            </label>
            <p className="j-help">
              默认 /交易日记/交易日记.xlsx。请使用本页导出的 Excel
              格式；目录和新文件会在首次保存时创建。连接后进入该账户独立日记，本机独立日记不会自动上传。
            </p>
            <div className="j-button-row">
              <Button className="j-btn" disabled={busy} type="normal" onClick={() => run(() => exportTrades([]))}>
                下载空白 Excel 模板
              </Button>
              <Button className="j-btn j-btn-primary" disabled={busy || !!drive} onClick={connect} type="primary">
                登录并加载 Excel
              </Button>
              {drive && (
                <Button
                  className="j-btn"
                  disabled={busy}
                  type="normal"
                  onClick={() =>
                    run(async () => {
                      await drive.disconnect();
                      localStorage.setItem(settingsKey, JSON.stringify({ config }));
                      setDrive(null);
                      setEditing(null);
                      setAccount('');
                      setCacheKey(localKey);
                      setCache(readJSON(localKey, emptyCache));
                      setDraft(blank());
                      setNotice('已断开连接，当前显示本机独立日记。');
                    })
                  }
                >
                  断开连接
                </Button>
              )}
            </div>
          </div>
        </section>
      )}
      {error && (
        <div role="alert" className="journal-alert error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="journal-alert">
          {notice}
        </div>
      )}
      <div className="journal-stats">
        <div>
          <span>交易记录</span>
          <strong>
            {all.length}
            <small>笔</small>
          </strong>
          <p>每笔交易，都有迹可循</p>
        </div>
        <div>
          <span>记录标的</span>
          <strong>
            {new Set(all.map((trade) => `${trade.type}:${trade.code}`)).size}
            <small>个</small>
          </strong>
          <p>股票与基金，统一记录</p>
        </div>
        <div>
          <span>累计交易费用</span>
          <strong>{number(totalFees)}</strong>
          <p>按记录的原始币种金额汇总</p>
        </div>
        <div>
          <span>同步状态</span>
          <strong className="journal-status-text">{syncLabel}</strong>
          <p>
            {cache.lastSync && drive
              ? `最近同步 ${new Date(cache.lastSync).toLocaleString('zh-CN')}`
              : '连接 OneDrive 后开启跨设备同步'}
          </p>
        </div>
      </div>
      <div className="journal-workspace">
        <section className="j-panel journal-records">
          <div className="j-section-heading">
            <div>
              <h2>
                交易记录 <span className="j-count">{filtered.length}</span>
              </h2>
              <p className="j-help">回看每一笔交易，也回看当时的判断。</p>
            </div>
            <Button className="j-btn" disabled={busy} type="normal" onClick={() => run(() => exportTrades(all))}>
              ↓ 导出 Excel
            </Button>
          </div>
          <div className="journal-toolbar">
            <div className="j-tabs">
              {['全部', '股票', '基金'].map((type) => (
                <button key={type} className={filter === type ? 'active' : ''} onClick={() => setFilter(type)}>
                  {type}
                </button>
              ))}
            </div>
            <input
              aria-label="搜索交易"
              placeholder="搜索代码、名称或交易原因"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {!filtered.length ? (
            <div className="journal-empty">
              <div>
                <svg width="38" height="38" viewBox="0 0 38 38" fill="none" aria-hidden="true">
                  <path
                    d="M6 29V9m0 20h26M11 23l7-8 6 4 8-11"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h3>{all.length ? '没有找到匹配的记录' : '从第一笔交易开始'}</h3>
              <p>{all.length ? '试试其他关键词或交易类型。' : '记下买卖，也记下为什么。未来的你会感谢此刻的思考。'}</p>
            </div>
          ) : (
            <div className="journal-table-wrap">
              <table className="journal-table">
                <thead>
                  <tr>
                    <th>日期 / 标的</th>
                    <th>判断 / 方向</th>
                    <th>金额 / 单价</th>
                    <th>费用 / 份额</th>
                    <th>交易原因</th>
                    <th className="journal-actions-column">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((trade) => (
                    <tr key={trade.id}>
                      <td>
                        <span className="j-trade-date">{trade.date}</span>
                        <strong>{trade.name}</strong>
                        <span className="j-subtle">
                          {trade.code} <span className="j-asset-tag">{trade.type}</span>
                        </span>
                      </td>
                      <td>
                        <span className={`j-badge stance-${stanceStyles[trade.stance]}`}>{trade.stance}</span>
                        <span className={`j-direction ${trade.direction === '买入' ? 'buy' : 'sell'}`}>
                          {trade.direction === '买入' ? '↗' : '↘'} {trade.direction}
                        </span>
                      </td>
                      <td>
                        <strong className="j-numeric">{number(trade.amount)}</strong>
                        <span className="j-subtle">单价 {number(trade.price)}</span>
                      </td>
                      <td>
                        <span className="j-numeric">{number(trade.fee)}</span>
                        <span className="j-subtle">份额 {trade.shares === undefined ? '—' : number(trade.shares)}</span>
                      </td>
                      <td>
                        <details className="journal-reason">
                          <summary>{trade.reason ? trade.reason.split('\n')[0].slice(0, 36) : '未填写原因'}</summary>
                          <p>{trade.reason}</p>
                        </details>
                        {(cache.pending.some((item) => item.id === trade.id) ||
                          (cache.changes || []).some((change) => change.id === trade.id)) && (
                          <span className="j-local-label">{drive ? '待同步' : '本机记录'}</span>
                        )}
                      </td>
                      <td className="journal-actions-column">
                        <div className="journal-row-actions">
                          <Button
                            text
                            type="primary"
                            disabled={busy}
                            aria-label={`编辑 ${trade.name} ${trade.date}`}
                            onClick={() => startEdit(trade)}
                          >
                            编辑
                          </Button>
                          <Button
                            text
                            warning
                            disabled={busy}
                            aria-label={`删除 ${trade.name} ${trade.date}`}
                            onClick={() => setDeleteTarget(trade)}
                          >
                            删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="journal-table-footer">
            共 {filtered.length} 笔记录 <span>点击交易原因，展开完整思考</span>
          </div>
        </section>
        <section className="j-panel journal-entry" ref={formRef}>
          <div className="j-section-heading">
            <div>
              <h2>{editing ? '编辑交易' : '记一笔交易'}</h2>
            </div>
            {editing && (
              <Button text type="primary" disabled={busy} onClick={startNew}>
                取消编辑
              </Button>
            )}
          </div>
          {editing && (
            <p className="journal-edit-note">
              正在编辑 {editing.name} · {editing.date}，保存后更新原记录。
            </p>
          )}
          <form onSubmit={save}>
            <div className="j-form-grid">
              <label className="j-field">
                日期 <em>*</em>
                <input
                  aria-label="日期"
                  type="date"
                  required
                  value={draft.date}
                  onChange={(e) => field('date', e.target.value)}
                />
              </label>
              <label className="j-field">
                类型 <em>*</em>
                <select
                  aria-label="类型"
                  value={draft.type}
                  onChange={(e) => updateAsset(e.target.value as Trade['type'], draft.code)}
                >
                  <option>股票</option>
                  <option>基金</option>
                </select>
              </label>
              <label className="j-field">
                代码 <em>*</em>
                <input
                  aria-label="代码"
                  required
                  placeholder="如 600519 / 005827"
                  value={draft.code}
                  onChange={(e) => updateAsset(draft.type, e.target.value)}
                />
              </label>
              <label className="j-field">
                名称 <em>*</em>
                <input
                  aria-label="名称"
                  required
                  readOnly={!!known && !editing}
                  placeholder="首次记录时填写"
                  value={known && !editing ? known.name : draft.name}
                  onChange={(e) => field('name', e.target.value)}
                />
              </label>
            </div>
            {known && !editing && <p className="j-matched">✓ 已关联历史标的名称</p>}
            <div className="j-field">
              <span>
                交易判断 <em>*</em>
              </span>
              <div className="j-segment">
                {['看多', '看空', '平仓'].map((stance) => (
                  <button
                    type="button"
                    aria-pressed={draft.stance === stance}
                    className={draft.stance === stance ? 'selected' : ''}
                    key={stance}
                    onClick={() => field('stance', stance)}
                  >
                    {stance}
                  </button>
                ))}
              </div>
            </div>
            <div className="j-field">
              <span>
                交易方向 <em>*</em>
              </span>
              <div className="j-segment direction">
                {['买入', '卖出'].map((direction) => (
                  <button
                    type="button"
                    aria-pressed={draft.direction === direction}
                    className={draft.direction === direction ? 'selected' : ''}
                    key={direction}
                    onClick={() => field('direction', direction)}
                  >
                    {direction === '买入' ? '↗' : '↘'} {direction}
                  </button>
                ))}
              </div>
            </div>
            <div className="j-form-grid">
              <label className="j-field">
                交易总价 <em>*</em>
                <input
                  aria-label="交易总价"
                  type="number"
                  min="0.000001"
                  step="any"
                  required
                  placeholder="0.00"
                  value={draft.amount}
                  onChange={(e) => field('amount', e.target.value)}
                />
              </label>
              <label className="j-field">
                单价 <em>*</em>
                <input
                  aria-label="单价"
                  type="number"
                  min="0.000001"
                  step="any"
                  required
                  placeholder="0.00"
                  value={draft.price}
                  onChange={(e) => field('price', e.target.value)}
                />
              </label>
              <label className="j-field">
                份额 <span className="j-optional">选填</span>
                <input
                  aria-label="份额"
                  type="number"
                  min="0.000001"
                  step="any"
                  placeholder="输入实际成交份额"
                  value={draft.shares}
                  onChange={(e) => field('shares', e.target.value)}
                />
              </label>
              <label className="j-field">
                交易费用 <span className="j-optional">{automaticFee ? '自动计算' : '可手填 · 默认 0'}</span>
                <input
                  aria-label="交易费用"
                  type="number"
                  step="any"
                  required
                  readOnly={automaticFee}
                  value={automaticFee ? fee : draft.fee}
                  onChange={(e) => field('fee', e.target.value)}
                />
              </label>
            </div>
            <p className="j-fee-help">
              {draft.type === '股票'
                ? '费用 = 总价 − 单价 × 股数；未填份额时可手填费用。'
                : '基金费用默认 0，请按实际成交费用填写。'}
            </p>
            <label className="j-field">
              交易原因
              <textarea
                aria-label="交易原因"
                rows={4}
                placeholder="为什么在此刻交易？记录你的逻辑、预期与风险…"
                value={draft.reason}
                onChange={(e) => field('reason', e.target.value)}
              />
            </label>
            <Button className="j-btn j-btn-primary journal-save" htmlType="submit" disabled={busy} type="primary">
              {busy ? '正在保存…' : saveLabel}
            </Button>
            <p className="journal-save-note">
              {drive
                ? '先保存本机，再合并更新云端 Excel；同步失败可重试。'
                : '尚未连接 OneDrive，记录仅保存在当前浏览器。'}
            </p>
          </form>
        </section>
      </div>
      <Dialog
        title="删除交易记录"
        visible={!!deleteTarget}
        onClose={() => !busy && setDeleteTarget(null)}
        onCancel={() => setDeleteTarget(null)}
        onOk={() => deleteTarget && removeTrade(deleteTarget)}
        okProps={{ warning: true, disabled: busy, children: busy ? '正在删除…' : '确认删除' }}
        cancelProps={{ disabled: busy }}
      >
        <p>
          确定删除 {deleteTarget?.date} 的「{deleteTarget?.name}」交易记录吗？
        </p>
        <p>
          {drive
            ? '确认后将从日记和 OneDrive Excel 中删除，无法在本页撤销。'
            : '确认后将从本机日记中删除，无法在本页撤销。'}
        </p>
      </Dialog>
    </div>
  );
}
