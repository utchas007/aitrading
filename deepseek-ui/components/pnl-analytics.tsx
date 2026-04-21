"use client";

import { useEffect, useState, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = '7d' | '30d' | '90d' | 'all';
type Granularity = 'daily' | 'weekly' | 'monthly';

interface Summary {
  totalRealized: number;
  unrealizedPnl: number;
  portfolioValue: number;
  totalTrades: number;
  openTrades: number;
  winRate: number;
  winCount: number;
  lossCount: number;
  avgWin: number;
  avgLoss: number;
  avgHoldMinutes: number;
  maxDrawdown: number;
  bestTrade:  { pair: string; pnl: number | null; pnlPercent: number | null } | null;
  worstTrade: { pair: string; pnl: number | null; pnlPercent: number | null } | null;
  closeReasons: Record<string, number>;
}

interface CumulativePoint { date: string | null; cumulativePnl: number; tradePnl: number; pair: string }
interface BucketPoint     { pnl: number; trades: number; wins: number; [key: string]: string | number }
interface PairPoint       { pair: string; pnl: number; trades: number; wins: number; winRate: number }
interface RecentTrade {
  id: number; pair: string; type: string;
  entryPrice: number; exitPrice: number | null;
  pnl: number | null; pnlPercent: number | null;
  closeReason: string | null; closedAt: string | null;
}

interface AnalyticsData {
  summary: Summary;
  cumulativeSeries: CumulativePoint[];
  dailyBreakdown: BucketPoint[];
  weeklyBreakdown: BucketPoint[];
  monthlyBreakdown: BucketPoint[];
  pairBreakdown: PairPoint[];
  recentTrades: RecentTrade[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GREEN = '#00ff9f';
const RED   = '#ff4d6d';
const DIM   = '#94a3b8';
const BORDER = '#1a1a2e';
const CARD_BG = '#0d0d1e';

function fmtUSD(v: number): string {
  const abs = Math.abs(v);
  const str = abs >= 1000
    ? `$${(abs / 1000).toFixed(1)}k`
    : `$${abs.toFixed(2)}`;
  return v < 0 ? `-${str}` : str;
}

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
}

function fmtDuration(minutes: number): string {
  if (minutes < 60)      return `${Math.round(minutes)}m`;
  if (minutes < 1440)    return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
  const days = Math.floor(minutes / 1440);
  const hrs  = Math.floor((minutes % 1440) / 60);
  return `${days}d ${hrs}h`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtPeriodLabel(key: string, gran: Granularity): string {
  if (gran === 'monthly') {
    const [y, m] = key.split('-');
    return new Date(Number(y), Number(m) - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }
  const d = new Date(key);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color ?? '#fff' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: DIM, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 600, color: DIM, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
      {children}
    </div>
  );
}

function PnlTooltip({ active, payload }: { active?: boolean; payload?: { payload: CumulativePoint }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: '#0a0a14', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12, fontSize: 12 }}>
      <div style={{ color: DIM, marginBottom: 4 }}>{d.date ?? '—'}</div>
      <div style={{ color: d.cumulativePnl >= 0 ? GREEN : RED, fontWeight: 600 }}>
        Cumulative: {fmtUSD(d.cumulativePnl)}
      </div>
      <div style={{ color: d.tradePnl >= 0 ? GREEN : RED, marginTop: 2 }}>
        Trade: {fmtUSD(d.tradePnl)} ({d.pair})
      </div>
    </div>
  );
}

function BarTooltip({ active, payload, labelKey }: { active?: boolean; payload?: { payload: BucketPoint }[]; labelKey: string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: '#0a0a14', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12, fontSize: 12 }}>
      <div style={{ color: DIM, marginBottom: 4 }}>{String(d[labelKey])}</div>
      <div style={{ color: d.pnl >= 0 ? GREEN : RED, fontWeight: 600 }}>{fmtUSD(d.pnl)}</div>
      <div style={{ color: DIM, marginTop: 2 }}>{d.trades} trade{d.trades !== 1 ? 's' : ''} · {d.trades > 0 ? Math.round((d.wins / d.trades) * 100) : 0}% win</div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PnLAnalytics() {
  const [period, setPeriod] = useState<Period>('30d');
  const [gran, setGran] = useState<Granularity>('daily');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/trading/analytics?period=${p}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to load analytics');
      setData(json as AnalyticsData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(period); }, [period, fetchData]);

  // Auto-select sensible granularity based on period
  useEffect(() => {
    if (period === '7d')  setGran('daily');
    if (period === '30d') setGran('daily');
    if (period === '90d') setGran('weekly');
    if (period === 'all') setGran('monthly');
  }, [period]);

  // ── Shared styles ──
  const pillBtn = (active: boolean) => ({
    padding: '5px 14px',
    borderRadius: 6,
    border: `1px solid ${active ? GREEN : '#2a2a4a'}`,
    background: active ? `${GREEN}22` : 'transparent',
    color: active ? GREEN : '#888',
    cursor: 'pointer' as const,
    fontSize: 12,
    fontWeight: 600,
    transition: 'all 0.15s',
  });

  // ── Empty / error states ──
  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: RED }}>{error}</div>
    );
  }

  const s = data?.summary;
  const isFlatDataset = !!data && data.cumulativeSeries.length > 0 &&
    data.cumulativeSeries.every(p => p.cumulativePnl === 0 && p.tradePnl === 0);
  const periodData: BucketPoint[] = data
    ? (gran === 'daily'   ? data.dailyBreakdown
     : gran === 'weekly'  ? data.weeklyBreakdown
     :                      data.monthlyBreakdown)
    : [];
  const periodLabelKey = gran === 'daily' ? 'date' : gran === 'weekly' ? 'weekStart' : 'month';

  const periodDataLabeled = periodData.map(d => ({
    ...d,
    label: fmtPeriodLabel(String(d[periodLabelKey]), gran),
  }));

  const pnlColor = (v: number) => v >= 0 ? GREEN : RED;

  return (
    <div style={{ padding: '24px 28px', color: '#c8d0e0', minHeight: '100vh' }}>

      {/* ── Header + Period Selector ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>P&L Analytics</div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>Realized performance from closed trades</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['7d', '30d', '90d', 'all'] as Period[]).map(p => (
            <button key={p} style={pillBtn(period === p)} onClick={() => setPeriod(p)}>
              {p === 'all' ? 'All' : p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#666', paddingTop: 80, fontSize: 14 }}>Loading analytics…</div>
      ) : !data ? null : (
        <>
          {isFlatDataset && (
            <div style={{
              marginBottom: 16,
              padding: '10px 12px',
              borderRadius: 8,
              border: `1px solid ${BORDER}`,
              background: '#0a0a14',
              color: DIM,
              fontSize: 12,
            }}>
              Analytics is loading correctly. Current period has closed trades, but all realized P&L values are 0.00, so charts appear flat.
            </div>
          )}

          {/* ── Summary Cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 28 }}>
            <StatCard
              label="Realized P&L"
              value={fmtUSD(s!.totalRealized)}
              sub={`Unrealized: ${fmtUSD(s!.unrealizedPnl)}`}
              color={pnlColor(s!.totalRealized)}
            />
            <StatCard
              label="Win Rate"
              value={`${(s!.winRate * 100).toFixed(1)}%`}
              sub={`${s!.winCount}W · ${s!.lossCount}L · ${s!.totalTrades} total`}
              color={s!.winRate >= 0.5 ? GREEN : RED}
            />
            <StatCard
              label="Avg Win / Loss"
              value={`${fmtUSD(s!.avgWin)}`}
              sub={`Avg loss: ${fmtUSD(s!.avgLoss)}`}
              color={GREEN}
            />
            <StatCard
              label="Avg Hold Time"
              value={fmtDuration(s!.avgHoldMinutes)}
              sub={`${s!.openTrades} position${s!.openTrades !== 1 ? 's' : ''} open`}
            />
            <StatCard
              label="Max Drawdown"
              value={s!.maxDrawdown > 0 ? `-${fmtUSD(s!.maxDrawdown)}` : '—'}
              color={s!.maxDrawdown > 0 ? RED : '#666'}
            />
          </div>

          {/* ── Best / Worst Trade ── */}
          {(s!.bestTrade || s!.worstTrade) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28 }}>
              {s!.bestTrade && (
                <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>BEST TRADE</div>
                    <div style={{ fontWeight: 700, color: '#fff' }}>{s!.bestTrade.pair}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: GREEN, fontWeight: 700, fontSize: 16 }}>{fmtUSD(s!.bestTrade.pnl ?? 0)}</div>
                    {s!.bestTrade.pnlPercent != null && (
                      <div style={{ color: GREEN, fontSize: 11 }}>+{s!.bestTrade.pnlPercent.toFixed(2)}%</div>
                    )}
                  </div>
                </div>
              )}
              {s!.worstTrade && (
                <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>WORST TRADE</div>
                    <div style={{ fontWeight: 700, color: '#fff' }}>{s!.worstTrade.pair}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: RED, fontWeight: 700, fontSize: 16 }}>{fmtUSD(s!.worstTrade.pnl ?? 0)}</div>
                    {s!.worstTrade.pnlPercent != null && (
                      <div style={{ color: RED, fontSize: 11 }}>{s!.worstTrade.pnlPercent.toFixed(2)}%</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Cumulative P&L Chart ── */}
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '16px 20px', marginBottom: 24 }}>
            <SectionTitle>Cumulative Realized P&L</SectionTitle>
            {data.cumulativeSeries.length === 0 ? (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 13 }}>
                No closed trades in this period
              </div>
            ) : isFlatDataset ? (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 13 }}>
                Flat P&L series (all trades closed at 0.00 realized P&L)
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.cumulativeSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cumGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={pnlColor(s!.totalRealized)} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={pnlColor(s!.totalRealized)} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                  <XAxis dataKey="date" stroke="#555" style={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis stroke="#555" style={{ fontSize: 10 }} tickFormatter={v => fmtUSD(v)} width={70} />
                  <ReferenceLine y={0} stroke="#333" strokeDasharray="4 4" />
                  <Tooltip content={<PnlTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="cumulativePnl"
                    stroke={pnlColor(s!.totalRealized)}
                    strokeWidth={2}
                    fill="url(#cumGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── Period Breakdown + Per-Pair ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>

            {/* Period bar chart */}
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <SectionTitle>P&L by Period</SectionTitle>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['daily', 'weekly', 'monthly'] as Granularity[]).map(g => (
                    <button key={g} style={{ ...pillBtn(gran === g), padding: '3px 10px', fontSize: 11 }} onClick={() => setGran(g)}>
                      {g.charAt(0).toUpperCase() + g.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {periodDataLabeled.length === 0 ? (
                <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 12 }}>No data</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={periodDataLabeled} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
                    <XAxis dataKey="label" stroke="#555" style={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis stroke="#555" style={{ fontSize: 10 }} tickFormatter={v => fmtUSD(v)} width={64} />
                    <ReferenceLine y={0} stroke="#333" />
                    <Tooltip content={<BarTooltip labelKey="label" />} />
                    <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                      {periodDataLabeled.map((entry, i) => (
                        <Cell key={i} fill={entry.pnl >= 0 ? `${GREEN}cc` : `${RED}cc`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Per-pair bar chart */}
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '16px 20px' }}>
              <SectionTitle>P&L by Symbol</SectionTitle>
              {data.pairBreakdown.length === 0 ? (
                <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 12 }}>No data</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.pairBreakdown} layout="vertical" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={BORDER} horizontal={false} />
                    <XAxis type="number" stroke="#555" style={{ fontSize: 10 }} tickFormatter={v => fmtUSD(v)} />
                    <YAxis type="category" dataKey="pair" stroke="#555" style={{ fontSize: 11 }} width={48} />
                    <ReferenceLine x={0} stroke="#333" />
                    <Tooltip
                      formatter={(v) => [fmtUSD(v != null ? Number(v) : 0), 'P&L']}
                      contentStyle={{ background: '#0a0a14', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: DIM }}
                    />
                    <Bar dataKey="pnl" radius={[0, 3, 3, 0]}>
                      {data.pairBreakdown.map((entry, i) => (
                        <Cell key={i} fill={entry.pnl >= 0 ? `${GREEN}cc` : `${RED}cc`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* ── Close Reasons + Recent Trades ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 16 }}>

            {/* Close reasons */}
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '16px 20px', minWidth: 180 }}>
              <SectionTitle>Exit Reasons</SectionTitle>
              {Object.keys(s!.closeReasons).length === 0 ? (
                <div style={{ color: '#666', fontSize: 12 }}>No data</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {Object.entries(s!.closeReasons)
                    .sort(([, a], [, b]) => b - a)
                    .map(([reason, count]) => {
                      const total = s!.totalTrades || 1;
                      const pct = Math.round((count / total) * 100);
                      const color = reason === 'take_profit' ? GREEN : reason === 'stop_loss' ? RED : DIM;
                      return (
                        <div key={reason}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                            <span style={{ fontSize: 11, color, textTransform: 'capitalize' }}>
                              {reason.replace(/_/g, ' ')}
                            </span>
                            <span style={{ fontSize: 11, color: '#666' }}>{count} ({pct}%)</span>
                          </div>
                          <div style={{ height: 4, background: '#1a1a2e', borderRadius: 2 }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2 }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Recent Trades table */}
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '16px 20px', overflow: 'hidden' }}>
              <SectionTitle>Recent Closed Trades</SectionTitle>
              {data.recentTrades.length === 0 ? (
                <div style={{ color: '#666', fontSize: 12 }}>No closed trades in this period</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ color: '#555', textAlign: 'left' }}>
                        {['Symbol', 'Side', 'Entry', 'Exit', 'P&L', '%', 'Exit Reason', 'Closed'].map(h => (
                          <th key={h} style={{ padding: '4px 10px 8px 0', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentTrades.map((t) => (
                        <tr key={t.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                          <td style={{ padding: '7px 10px 7px 0', color: '#fff', fontWeight: 600 }}>{t.pair}</td>
                          <td style={{ padding: '7px 10px 7px 0', color: t.type === 'buy' ? GREEN : RED, textTransform: 'uppercase', fontSize: 10, fontWeight: 700 }}>{t.type}</td>
                          <td style={{ padding: '7px 10px 7px 0', color: DIM }}>${t.entryPrice?.toFixed(2) ?? '—'}</td>
                          <td style={{ padding: '7px 10px 7px 0', color: DIM }}>{t.exitPrice != null ? `$${t.exitPrice.toFixed(2)}` : '—'}</td>
                          <td style={{ padding: '7px 10px 7px 0', color: (t.pnl ?? 0) >= 0 ? GREEN : RED, fontWeight: 600 }}>
                            {t.pnl != null ? fmtUSD(t.pnl) : '—'}
                          </td>
                          <td style={{ padding: '7px 10px 7px 0', color: (t.pnlPercent ?? 0) >= 0 ? GREEN : RED }}>
                            {t.pnlPercent != null ? `${t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent.toFixed(2)}%` : '—'}
                          </td>
                          <td style={{ padding: '7px 10px 7px 0', color: t.closeReason === 'take_profit' ? GREEN : t.closeReason === 'stop_loss' ? RED : DIM, fontSize: 11, textTransform: 'capitalize' }}>
                            {t.closeReason?.replace(/_/g, ' ') ?? '—'}
                          </td>
                          <td style={{ padding: '7px 0 7px 0', color: '#555', whiteSpace: 'nowrap' }}>{fmtDate(t.closedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
