import * as React from 'react';
import { Card, Input, Select, Button } from '@alifd/next';
import { convertPrice, fetchExchangeRate, ExchangeRate, isPositiveNumber } from './model';
import './index.css';

export default function USDOunceToRMBGram() {
    const [mode, setMode] = React.useState<'auto' | 'manual'>('auto');
    const [manualRate, setManualRate] = React.useState('');
    const [quote, setQuote] = React.useState<ExchangeRate | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [revision, setRevision] = React.useState(0);
    const [usdPerOunce, setUsdPerOunce] = React.useState('');
    const [rmbPerGram, setRmbPerGram] = React.useState('');

    React.useEffect(() => {
        if (mode !== 'auto') return;
        const controller = new AbortController();
        let active = true;
        let timedOut = false;
        setLoading(true);
        setError('');
        setQuote(null);
        const timeout = window.setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, 10000);
        fetchExchangeRate(controller.signal).then(result => {
            if (active) setQuote(result);
        }).catch(() => {
            if (active) setError(timedOut ? '汇率获取超时，请重试或切换到手动输入。' : '汇率获取失败，请重试或切换到手动输入。');
        }).finally(() => {
            window.clearTimeout(timeout);
            if (active) setLoading(false);
        });
        return () => {
            active = false;
            window.clearTimeout(timeout);
            controller.abort();
        };
    }, [mode, revision]);

    const rate = mode === 'auto' ? (loading || error ? '' : String(quote?.rate ?? '')) : manualRate;
    const invalidRate = mode === 'manual' && !isPositiveNumber(manualRate);
    const changeMode = (value: 'auto' | 'manual') => {
        if (value === mode) return;
        if (value === 'manual' && manualRate === '' && quote) setManualRate(String(quote.rate));
        // Clear the previous quote before the next effect runs.
        if (value === 'auto') { setQuote(null); setLoading(true); setError(''); }
        setMode(value);
    };

    return <Card free className="gold-converter">
        <Card.Header title="美元每盎司与人民币每克互转" />
        <Card.Content>
            <label className="gold-label" htmlFor="gold-exchange-rate">美元兑人民币汇率（1 美元 = 人民币）</label>
            <div className="gold-rate-row">
                <Input
                    id="gold-exchange-rate"
                    className="gold-rate-input"
                    value={rate}
                    readOnly={mode === 'auto'}
                    placeholder={mode === 'auto' ? (loading ? '正在获取…' : '暂无汇率') : '请输入汇率'}
                    onChange={value => setManualRate(String(value))}
                    inputMode="decimal"
                    state={invalidRate ? 'error' : undefined}
                    aria-describedby="gold-rate-status"
                    aria-invalid={invalidRate}
                    addonBefore={<Select
                        aria-label="汇率来源"
                        className="gold-rate-mode"
                        value={mode}
                        onChange={changeMode}
                        hasArrow={false}
                        dataSource={[{ value: 'auto', label: <span className="gold-source-label"><img src="./frankfurter.ico" alt="" width={16} height={16} />Frankfurter</span> }, { value: 'manual', label: '手动输入' }]}
                    />}
                />
                {mode === 'auto' && <Button
                    className="gold-refresh-button"
                    disabled={loading}
                    aria-label={loading ? '正在获取汇率' : error ? '重试获取汇率' : '刷新汇率'}
                    title={loading ? '正在获取汇率' : error ? '重试获取汇率' : '刷新汇率'}
                    aria-busy={loading}
                    onClick={() => {
                        setQuote(null); setLoading(true); setError(''); setRevision(v => v + 1);
                    }}>
                    <svg className={loading ? 'gold-refresh-icon gold-refresh-spinning' : 'gold-refresh-icon'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                        <path d="M21 3v5h-5" />
                    </svg>
                </Button>}
            </div>
            <p id="gold-rate-status" className={`gold-rate-status${(error && mode === 'auto') || invalidRate ? ' gold-error' : ''}`} aria-live="polite">
                {mode === 'manual'
                    ? (invalidRate ? '请输入大于 0 的有效汇率。' : '使用手动汇率计算；切回 Frankfurter 可更新汇率。')
                    : loading ? '正在获取最新美元兑人民币汇率…'
                        : error || (quote && <>来源：<a href="https://frankfurter.dev/" target="_blank" rel="noreferrer">Frankfurter</a> · 数据日期：{quote.date}。每日更新，当日未发布时使用最近可用数据。</>)}
            </p>
            <div className="gold-conversion-row">
                <div><label className="gold-label" htmlFor="gold-usd-input">美元每盎司</label><Input id="gold-usd-input" value={usdPerOunce} inputMode="decimal" placeholder="1946.7" onChange={value => setUsdPerOunce(String(value))} aria-invalid={usdPerOunce !== '' && !isPositiveNumber(usdPerOunce, true)} /></div>
                <span className="gold-arrow" aria-hidden="true">→</span>
                <div><label className="gold-label" htmlFor="gold-cny-result">人民币每克</label><Input id="gold-cny-result" value={convertPrice(usdPerOunce, rate, 'usdToCny')} placeholder="—" readOnly /></div>
            </div>
            <div className="gold-conversion-row">
                <div><label className="gold-label" htmlFor="gold-cny-input">人民币每克</label><Input id="gold-cny-input" value={rmbPerGram} inputMode="decimal" placeholder="459.6" onChange={value => setRmbPerGram(String(value))} aria-invalid={rmbPerGram !== '' && !isPositiveNumber(rmbPerGram, true)} /></div>
                <span className="gold-arrow" aria-hidden="true">→</span>
                <div><label className="gold-label" htmlFor="gold-usd-result">美元每盎司</label><Input id="gold-usd-result" value={convertPrice(rmbPerGram, rate, 'cnyToUsd')} placeholder="—" readOnly /></div>
            </div>
            <p className="gold-footnote">1 金衡盎司 = 31.1034768 克。换算结果保留两位小数。</p>
        </Card.Content>
    </Card>;
}
