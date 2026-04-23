"use client";

import { useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import type { BacktestResult, BacktestTrade } from '@/lib/backtest';

// ─── Theme ────────────────────────────────────────────────────────────────────
const GREEN  = '#00ff9f';
const RED    = '#ff4d6d';
const DIM    = '#94a3b8';
const BORDER = '#1a1a2e';
const BG     = '#0d0d1a';
const CARD   = '#10102a';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt$ = (n: number) =>
  (n >= 0 ? '+' : '') + n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtPct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const color  = (n: number) => (n >= 0 ? GREEN : RED);

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 18px' }}>
      <div style={{ color: DIM, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ color: DIM, fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Default form values ──────────────────────────────────────────────────────
const TODAY  = new Date().toISOString().split('T')[0];
const YEAR_AGO = new Date(Date.now() - 365 * 86_400_000).toISOString().split('T')[0];

interface FormState {
  symbol: string;
  startDate: string;
  endDate: string;
  initialCash: string;
  minConfidence: string;
  stopLossPercent: string;
  takeProfitPercent: string;
  partialProfitPercent: string;
  trailingActivationPercent: string;
  trailingStopPercent: string;
  riskPerTrade: string;
}

const DEFAULT_FORM: FormState = {
  symbol:                    'AAPL',
  startDate:                 YEAR_AGO,
  endDate:                   TODAY,
  initialCash:               '100000',
  minConfidence:             '75',
  stopLossPercent:           '5',
  takeProfitPercent:         '10',
  partialProfitPercent:      '5',
  trailingActivationPercent: '7',
  trailingStopPercent:       '3',
  riskPerTrade:              '10',
};

// ─── Input ────────────────────────────────────────────────────────────────────
function Field({
  label, value, onChange, type = 'text', suffix,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; suffix?: string;
}) {
  return (
    <div>
      <label style={{ color: DIM, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{
            flex: 1, background: '#0a0a1e', border: `1px solid ${BORDER}`, borderRadius: 6,
            color: '#e2e8f0', padding: '6px 10px', fontSize: 13, outline: 'none',
          }}
        />
        {suffix && <span style={{ color: DIM, fontSize: 12 }}>{suffix}</span>}
      </div>
    </div>
  );
}

// ─── Trade table ──────────────────────────────────────────────────────────────
function TradeRow({ t }: { t: BacktestTrade }) {
  return (
    <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
      <td style={{ padding: '8px 12px', color: DIM, fontSize: 12 }}>{t.entryDate}</td>
      <td style={{ padding: '8px 12px', color: DIM, fontSize: 12 }}>{t.exitDate}</td>
      <td style={{ padding: '8px 12px', color: t.type === 'buy' ? GREEN : RED, fontSize: 12, fontWeight: 700 }}>
        {t.type.toUpperCase()}
      </td>
      <td style={{ padding: '8px 12px', color: '#e2e8f0', fontSize: 12 }}>${t.entryPrice.toFixed(2)}</td>
      <td style={{ padding: '8px 12px', color: '#e2e8f0', fontSize: 12 }}>${t.exitPrice.toFixed(2)}</td>
      <td style={{ padding: '8px 12px', color: '#e2e8f0', fontSize: 12 }}>{t.shares}</td>
      <td style={{ padding: '8px 12px', color: color(t.pnl), fontSize: 12, fontWeight: 600 }}>
        {fmt$(t.pnl)}
      </td>
      <td style={{ padding: '8px 12px', color: color(t.pnlPercent), fontSize: 12 }}>
        {fmtPct(t.pnlPercent)}
      </td>
      <td style={{ padding: '8px 12px', color: DIM, fontSize: 11 }}>
        {t.closeReason.replace(/_/g, ' ')}
      </td>
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function BacktestPanel() {
  const [form, setForm]       = useState<FormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [result, setResult]   = useState<BacktestResult | null>(null);

  const set = (key: keyof FormState) => (v: string) => setForm(f => ({ ...f, [key]: v }));

  async function runBacktest() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/trading/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol:                    form.symbol.trim().toUpperCase(),
          startDate:                 form.startDate,
          endDate:                   form.endDate,
          initialCash:               parseFloat(form.initialCash),
          minConfidence:             parseFloat(form.minConfidence),
          stopLossPercent:           parseFloat(form.stopLossPercent)           / 100,
          takeProfitPercent:         parseFloat(form.takeProfitPercent)         / 100,
          partialProfitPercent:      parseFloat(form.partialProfitPercent)      / 100,
          trailingActivationPercent: parseFloat(form.trailingActivationPercent) / 100,
          trailingStopPercent:       parseFloat(form.trailingStopPercent)       / 100,
          riskPerTrade:              parseFloat(form.riskPerTrade)              / 100,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Backtest failed');
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const m = result?.metrics;

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 28px', color: '#e2e8f0', fontFamily: 'monospace' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>
            🧪 Backtester
          </h1>
          <p style={{ color: DIM, fontSize: 13, marginTop: 4 }}>
            Replay the bot&apos;s technical strategy against stored daily candles — no AI or IB calls.
          </p>
        </div>

        {/* Config form */}
        <div style={{
          background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, marginBottom: 24,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
            <Field label="Symbol"          value={form.symbol}                    onChange={set('symbol')} />
            <Field label="Start Date"      value={form.startDate}                 onChange={set('startDate')}  type="date" />
            <Field label="End Date"        value={form.endDate}                   onChange={set('endDate')}    type="date" />
            <Field label="Initial Cash"    value={form.initialCash}               onChange={set('initialCash')} suffix="$" />
            <Field label="Risk / Trade"    value={form.riskPerTrade}              onChange={set('riskPerTrade')} suffix="%" />
            <Field label="Min Confidence"  value={form.minConfidence}             onChange={set('minConfidence')} suffix="%" />
            <Field label="Stop Loss"       value={form.stopLossPercent}           onChange={set('stopLossPercent')} suffix="%" />
            <Field label="Take Profit"     value={form.takeProfitPercent}         onChange={set('takeProfitPercent')} suffix="%" />
            <Field label="Partial Profit"  value={form.partialProfitPercent}      onChange={set('partialProfitPercent')} suffix="%" />
            <Field label="Trail Activate"  value={form.trailingActivationPercent} onChange={set('trailingActivationPercent')} suffix="%" />
            <Field label="Trail Distance"  value={form.trailingStopPercent}       onChange={set('trailingStopPercent')} suffix="%" />
          </div>
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={runBacktest}
              disabled={loading}
              style={{
                background: loading ? '#1a1a2e' : GREEN,
                color: loading ? DIM : '#000',
                border: 'none', borderRadius: 8, padding: '10px 28px',
                fontWeight: 700, fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {loading ? '⏳ Running...' : '▶ Run Backtest'}
            </button>
            {error && <span style={{ color: RED, fontSize: 13 }}>⚠ {error}</span>}
            {result && !loading && (
              <span style={{ color: DIM, fontSize: 12 }}>
                {result.dataPoints} trading days · {result.trades.length} trades
              </span>
            )}
          </div>
        </div>

        {/* Results */}
        {result && m && (
          <>
            {/* Metric cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
              <MetricCard
                label="Total Return"
                value={fmtPct(m.totalReturnPercent)}
                sub={fmt$(m.totalReturn)}
              />
              <MetricCard
                label="Win Rate"
                value={(m.winRate * 100).toFixed(1) + '%'}
                sub={`${m.winCount}W / ${m.lossCount}L`}
              />
              <MetricCard
                label="Profit Factor"
                value={m.profitFactor >= 999 ? '∞' : m.profitFactor.toFixed(2)}
              />
              <MetricCard
                label="Sharpe Ratio"
                value={m.sharpeRatio.toFixed(2)}
              />
              <MetricCard
                label="Max Drawdown"
                value={fmtPct(-m.maxDrawdownPercent)}
                sub={fmt$(-m.maxDrawdown)}
              />
              <MetricCard
                label="Avg Win"
                value={fmt$(m.avgWin)}
              />
              <MetricCard
                label="Avg Loss"
                value={fmt$(m.avgLoss)}
              />
              <MetricCard
                label="Avg Hold"
                value={m.avgHoldDays.toFixed(1) + ' days'}
                sub={`${m.totalTrades} total trades`}
              />
            </div>

            {/* Equity curve */}
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, marginBottom: 24 }}>
              <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 14 }}>Equity Curve</div>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={result.equityCurve}>
                  <defs>
                    <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={GREEN} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={GREEN} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                  <XAxis dataKey="date" tick={{ fill: DIM, fontSize: 11 }}
                    tickFormatter={v => v?.slice(2) ?? ''} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: DIM, fontSize: 11 }}
                    tickFormatter={v => '$' + (v / 1000).toFixed(0) + 'k'} />
                  <Tooltip
                    contentStyle={{ background: '#0d0d1a', border: `1px solid ${BORDER}`, borderRadius: 8 }}
                    labelStyle={{ color: DIM }}
                    formatter={(v: unknown) => ['$' + (v as number).toLocaleString(), 'Equity']}
                  />
                  <ReferenceLine y={result.config.initialCash} stroke={DIM} strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="equity" stroke={GREEN} strokeWidth={2} fill="url(#eqGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Drawdown chart */}
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, marginBottom: 24 }}>
              <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 14 }}>Drawdown (%)</div>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={result.equityCurve}>
                  <defs>
                    <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={RED} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={RED} stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                  <XAxis dataKey="date" tick={{ fill: DIM, fontSize: 11 }}
                    tickFormatter={v => v?.slice(2) ?? ''} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: DIM, fontSize: 11 }}
                    tickFormatter={v => '-' + v.toFixed(1) + '%'} />
                  <Tooltip
                    contentStyle={{ background: '#0d0d1a', border: `1px solid ${BORDER}`, borderRadius: 8 }}
                    labelStyle={{ color: DIM }}
                    formatter={(v: unknown) => ['-' + (v as number).toFixed(2) + '%', 'Drawdown']}
                  />
                  <Area type="monotone" dataKey="drawdownPercent" stroke={RED} strokeWidth={1.5} fill="url(#ddGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* P&L per trade bar chart */}
            {result.trades.length > 0 && (
              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, marginBottom: 24 }}>
                <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 14 }}>P&L per Trade</div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={result.trades} barSize={Math.max(4, Math.min(20, 400 / result.trades.length))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis dataKey="entryDate" tick={{ fill: DIM, fontSize: 10 }}
                      tickFormatter={v => v?.slice(5) ?? ''} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: DIM, fontSize: 11 }}
                      tickFormatter={v => '$' + (v / 1000).toFixed(0) + 'k'} />
                    <ReferenceLine y={0} stroke={DIM} />
                    <Tooltip
                      contentStyle={{ background: '#0d0d1a', border: `1px solid ${BORDER}`, borderRadius: 8 }}
                      formatter={(v: unknown) => [fmt$(v as number), 'P&L']}
                    />
                    <Bar dataKey="pnl">
                      {result.trades.map((t, i) => (
                        <Cell key={i} fill={t.pnl >= 0 ? GREEN : RED} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Trade log */}
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: `1px solid ${BORDER}`, color: '#e2e8f0', fontWeight: 600 }}>
                Trade Log ({result.trades.length})
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#0a0a1e' }}>
                      {['Entry', 'Exit', 'Type', 'Entry $', 'Exit $', 'Shares', 'P&L', 'P&L %', 'Reason'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', color: DIM, fontSize: 11, textAlign: 'left',
                          textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, i) => <TradeRow key={i} t={t} />)}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {!result && !loading && (
          <div style={{ textAlign: 'center', color: DIM, padding: '60px 0', fontSize: 14 }}>
            Configure the parameters above and click <strong style={{ color: GREEN }}>Run Backtest</strong>.
            <br />
            <span style={{ fontSize: 12 }}>
              Requires stored daily candles in the DB — the bot saves them automatically while running.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
