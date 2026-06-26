import React, { useState, useEffect, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { ShieldCheck, AlertTriangle, ClipboardList, Award } from 'lucide-react';
import useThemeStore from '../../store/useThemeStore';
import { getThemeTokens } from '../../utils/themeTokens';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

function useQualityDashboardData() {
  const [summary, setSummary] = useState(null);
  const [recent,  setRecent]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/quality-dashboard/summary`)
      .then(r => { if (!r.ok) throw new Error(`summary: ${r.status}`); return r.json(); })
      .then(sum => {
        setSummary(sum);
        const ref = sum.latestDate ? `?reference_date=${sum.latestDate}&limit=10` : '?limit=10';
        return fetch(`${API_BASE}/quality-dashboard/recent-inspections${ref}`)
          .then(r => { if (!r.ok) throw new Error(`recent: ${r.status}`); return r.json(); });
      })
      .then(rec => { setRecent(rec); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  return { summary, recent, loading, error };
}

function resultStyle(result, T) {
  const r = (result || '').toLowerCase();
  if (r === 'pass') return { color: T.green.solid, bg: T.green.light };
  if (r === 'fail') return { color: T.red.solid,   bg: T.red.light   };
  return                   { color: T.amber.solid,  bg: T.amber.light };
}

function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

let _sparkId = 0;
function Sparkline({ data, color }) {
  const id = useRef(`qspk-${_sparkId++}`).current;
  const w = 64, h = 32;
  if (!data || data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const pts = data.map((p, i) => ({ x: (i / (data.length - 1)) * w, y: h - 5 - ((p - min) / range) * (h - 10) }));
  const linePath = `M${pts.map(p => `${p.x},${p.y}`).join(' L')}`;
  const areaPath = `${linePath} L${pts[pts.length-1].x},${h} L${pts[0].x},${h} Z`;
  return (
    <svg width={w} height={h} style={{ overflow: 'visible', flexShrink: 0 }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.55" />
          <stop offset="60%"  stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0"    />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${id})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length-1].x} cy={pts[pts.length-1].y} r="3.5" fill={color} />
    </svg>
  );
}

function Card({ children, style = {} }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: 'var(--surf)', borderRadius: 12, border: `1px solid ${hov ? 'var(--brd2)' : 'var(--brd)'}`, boxShadow: hov ? '0 8px 28px rgba(0,0,0,0.15)' : '0 1px 3px rgba(0,0,0,0.06)', transform: hov ? 'translateY(-2px)' : 'none', transition: 'all 0.2s ease', ...style }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)', letterSpacing: '0.01em' }}>{children}</span>
      {action && <span style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600, cursor: 'pointer' }}>{action}</span>}
    </div>
  );
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--surf)', border: '1px solid var(--brd)', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
      <div style={{ fontWeight: 700, color: 'var(--txt)', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.fill }}>{p.name}: {p.value}%</div>)}
    </div>
  );
}

const CSS = `
  .qlt-kpi  { display:grid; grid-template-columns:repeat(2,1fr); gap:10px }
  @media(min-width:640px) { .qlt-kpi { grid-template-columns:repeat(4,1fr) } }
  .qlt-main { display:grid; grid-template-columns:1fr; gap:12px; flex:1; min-height:0 }
  @media(min-width:768px) { .qlt-main { grid-template-columns:1fr 1fr } }
  @media(min-width:1280px){ .qlt-main { grid-template-columns:1fr 1.8fr 1.3fr } }
  .qlt-kpi-val { font-size:22px }
  @media(min-width:480px){ .qlt-kpi-val { font-size:26px } }
`;

export default function QualityDashboard() {
  const { theme } = useThemeStore();
  const T = getThemeTokens(theme === 'dark');

  const { summary, recent, loading, error } = useQualityDashboardData();

  if (loading) {
    return (
      <div style={{ fontFamily: 'Inter, system-ui, sans-serif', background: 'var(--bg)', minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--txt2)', fontSize: 14 }}>Loading quality data…</div>
      </div>
    );
  }

  if (error || !summary?.today) {
    return (
      <div style={{ fontFamily: 'Inter, system-ui, sans-serif', background: 'var(--bg)', minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: T.red.text, fontSize: 13 }}>Failed to load quality data{error ? `: ${error}` : ''}</div>
      </div>
    );
  }

  const today     = summary.today;
  const yesterday = summary.yesterday;
  const last9     = summary.last9 || [];

  const passRateSpark = last9.map(d => d.qualityPassRate);
  const ncrSpark      = last9.map(d => d.openNcrs);
  const capaSpark     = last9.map(d => d.capaPending);
  const auditSpark    = last9.map(d => d.auditScore);

  const passRateDelta = yesterday != null ? today.qualityPassRate - yesterday.qualityPassRate : null;
  const ncrVsWeekAgo  = last9.length >= 2  ? today.openNcrs - last9[0].openNcrs : null;
  const auditDelta    = today.auditScore - today.prevAuditScore;

  const fmtSign = (v, decimals = 1) => v == null || isNaN(v) ? 'N/A' : `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}`;

  const kpiCards = [
    {
      label: 'Inspection Pass Rate',
      value: `${today.qualityPassRate.toFixed(1)}%`,
      delta: passRateDelta != null ? `${fmtSign(passRateDelta)}% vs yesterday` : 'no prior data',
      pos:   passRateDelta == null || passRateDelta >= 0,
      spark: passRateSpark, color: T.green.solid, bg: T.green.light, Icon: ShieldCheck,
    },
    {
      label: 'Open NCRs',
      value: `${today.openNcrs}`,
      delta: ncrVsWeekAgo != null ? `${fmtSign(ncrVsWeekAgo, 0)} vs last week` : 'no prior data',
      pos:   ncrVsWeekAgo == null || ncrVsWeekAgo <= 0,
      spark: ncrSpark, color: T.amber.solid, bg: T.amber.light, Icon: AlertTriangle,
    },
    {
      label: 'CAPA Pending',
      value: `${today.capaPending}`,
      delta: `${today.capaCritical} critical, ${today.capaMajor} major`,
      pos:   today.capaCritical === 0,
      spark: capaSpark, color: T.red.solid, bg: T.red.light, Icon: ClipboardList,
    },
    {
      label: 'Audit Score',
      value: `${today.auditScore.toFixed(1)}%`,
      delta: `${fmtSign(auditDelta)}% vs last audit`,
      pos:   auditDelta >= 0,
      spark: auditSpark, color: T.blue.solid, bg: T.blue.light, Icon: Award,
    },
  ];

  const devTotal = (today.deviationCritical + today.deviationMajor + today.deviationMinor) || 1;
  const deviations = [
    { label: 'Critical', count: today.deviationCritical, pct: Math.round(today.deviationCritical / devTotal * 100), color: T.red.solid,   bg: T.red.light   },
    { label: 'Major',    count: today.deviationMajor,    pct: Math.round(today.deviationMajor    / devTotal * 100), color: T.amber.solid, bg: T.amber.light },
    { label: 'Minor',    count: today.deviationMinor,    pct: Math.round(today.deviationMinor    / devTotal * 100), color: T.green.solid, bg: T.green.light },
  ];

  const trendData = last9.slice(-7).map(d => ({
    day:  new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
    pass: parseFloat(d.qualityPassRate.toFixed(1)),
    fail: parseFloat((100 - d.qualityPassRate).toFixed(1)),
  }));

  const upcomingAudits = (today.upcomingAudits || []).map(a => {
    const p = (a.priority || '').toLowerCase();
    const col = p === 'high' ? T.red : p === 'medium' ? T.amber : T.blue;
    return { ...a, color: col.solid, bg: col.light };
  });

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', background: 'var(--bg)', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--surf)', borderBottom: '1px solid var(--brd)', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: T.green.light, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={T.green.solid} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--txt)' }}>Quality Assurance</div>
            <div style={{ fontSize: 10.5, color: 'var(--txt3)' }}>QC & Compliance Dashboard</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, color: 'var(--txt3)' }}>{summary.latestDate}</span>
          <div style={{ fontSize: 10.5, color: T.green.text, background: T.green.light, padding: '4px 10px', borderRadius: 20, fontWeight: 600 }}>● Live</div>
        </div>
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>

        {/* KPI row */}
        <div className="qlt-kpi">
          {kpiCards.map((k) => (
            <Card key={k.label} style={{ padding: '14px 16px 12px', position: 'relative', overflow: 'hidden', cursor: 'pointer' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.color, borderRadius: '12px 12px 0 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 4, marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: 'var(--txt2)', fontWeight: 500, flex: 1, minWidth: 0, lineHeight: 1.4, paddingRight: 4 }}>{k.label}</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: k.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <k.Icon size={12} color={k.color} />
                  </div>
                  <Sparkline data={k.spark} color={k.color} />
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <span className="qlt-kpi-val" style={{ fontWeight: 800, color: 'var(--txt)', letterSpacing: '-0.03em' }}>{k.value}</span>
              </div>
              <div style={{ height: 1, background: 'var(--brd)', marginBottom: 8 }} />
              <div style={{ fontSize: 11, color: k.pos ? T.green.text : T.red.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {k.pos ? '↑' : '⚠'} {k.delta}
              </div>
            </Card>
          ))}
        </div>

        {/* Main row */}
        <div className="qlt-main">

          {/* Deviation by Severity + Upcoming Audits stacked in one grid cell */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
            <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', flex: 1 }}>
              <SectionTitle>Deviation by Severity</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {deviations.map((d) => (
                  <div key={d.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 12, color: 'var(--txt2)', fontWeight: 500 }}>{d.label}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--txt)' }}>{d.count}</span>
                        <span style={{ fontSize: 10, color: d.color, background: d.bg, padding: '1px 6px', borderRadius: 6, fontWeight: 600 }}>{d.pct}%</span>
                      </div>
                    </div>
                    <div style={{ height: 5, borderRadius: 4, background: 'rgba(128,128,128,0.15)', overflow: 'hidden' }}>
                      <div style={{ width: `${d.pct}%`, height: '100%', background: d.color, borderRadius: 4, transition: 'width 0.4s' }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {upcomingAudits.length > 0 && (
              <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                <SectionTitle>Upcoming Audits</SectionTitle>
                {upcomingAudits.map((a) => (
                  <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--brd)' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: a.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--txt3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.dept} · {fmtDate(a.date)}</div>
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </div>

          {/* Pass/Fail trend */}
          <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 260 }}>
            <SectionTitle>Inspection Score Trend (7 Days)</SectionTitle>
            {trendData.length > 0 ? (
              <div style={{ flex: 1, minHeight: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendData} barCategoryGap="22%" barGap={3} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--txt3)' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--txt3)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(128,128,128,0.06)' }} />
                    <Bar dataKey="pass" name="Pass %" fill={T.green.solid} radius={[4,4,0,0]} />
                    <Bar dataKey="fail" name="Fail %" fill={T.red.solid}   radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ flex: 1, minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt3)', fontSize: 13 }}>No trend data available</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 8, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: T.green.solid }} />
                <span style={{ fontSize: 11, color: 'var(--txt2)' }}>Pass %</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: T.red.solid }} />
                <span style={{ fontSize: 11, color: 'var(--txt2)' }}>Fail %</span>
              </div>
            </div>
          </Card>

          {/* Recent inspections */}
          <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 200, overflow: 'hidden' }}>
            <SectionTitle>Recent Inspections</SectionTitle>
            {recent.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1, overflow: 'auto' }}>
                {recent.map((r, i) => {
                  const rs = resultStyle(r.inspection_result, T);
                  return (
                    <div key={r.batch_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: i < recent.length - 1 ? '1px solid var(--brd)' : 'none' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.product_name}</div>
                        <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.batch_id} · {r.inspection_stage}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--txt)' }}>{r.inspection_score}</div>
                        <span style={{ fontSize: 10, fontWeight: 600, color: rs.color, background: rs.bg, padding: '1px 6px', borderRadius: 6 }}>{r.inspection_result}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: 'var(--txt3)', fontSize: 13 }}>No recent inspection records</div>
            )}
          </Card>

        </div>
      </div>
    </div>
  );
}
