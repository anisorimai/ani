import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const T = {
  bg: '#f0f2f7', surface: '#ffffff', border: '#e8eaf0',
  text: { primary: '#0f1117', secondary: '#5a6072', muted: '#9da3b4' },
  green:  { solid: '#16a34a', light: '#dcfce7', text: '#15803d' },
  blue:   { solid: '#2563eb', light: '#dbeafe', text: '#1d4ed8' },
  amber:  { solid: '#d97706', light: '#fef3c7', text: '#b45309' },
  red:    { solid: '#dc2626', light: '#fee2e2', text: '#b91c1c' },
};

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

function useQualityDashboardData() {
  const [summary, setSummary]   = useState(null);
  const [recent,  setRecent]    = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/quality-dashboard/summary`)
      .then(r => { if (!r.ok) throw new Error(`summary: ${r.status}`); return r.json(); })
      .then(sum => {
        setSummary(sum);
        const ref = sum.latestDate ? `?reference_date=${sum.latestDate}&limit=5` : '?limit=5';
        return fetch(`${API_BASE}/quality-dashboard/recent-inspections${ref}`)
          .then(r => { if (!r.ok) throw new Error(`recent: ${r.status}`); return r.json(); });
      })
      .then(rec => { setRecent(rec); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  return { summary, recent, loading, error };
}

function resultStyle(result) {
  const r = (result || '').toLowerCase();
  if (r === 'pass')   return { color: T.green.solid, bg: T.green.light };
  if (r === 'fail')   return { color: T.red.solid,   bg: T.red.light   };
  return                     { color: T.amber.solid,  bg: T.amber.light };
}

function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

function Sparkline({ data, color }) {
  const w = 64, h = 28;
  if (!data || data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const pts = data.map((p, i) => ({ x: (i / (data.length - 1)) * w, y: h - 4 - ((p - min) / range) * (h - 8) }));
  return (
    <svg width={w} height={h} style={{ overflow: 'visible', flexShrink: 0 }}>
      <polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length-1].x} cy={pts[pts.length-1].y} r="3" fill={color} />
    </svg>
  );
}

function Card({ children, style = {} }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: T.surface, borderRadius: 12, border: `1px solid ${hov ? '#c8ccd8' : T.border}`, boxShadow: hov ? '0 8px 28px rgba(0,0,0,0.10)' : '0 1px 3px rgba(0,0,0,0.04)', transform: hov ? 'translateY(-2px)' : 'none', transition: 'all 0.2s ease', ...style }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: T.text.primary }}>{children}</span>
      {action && <span style={{ fontSize: 11, color: T.blue.text, fontWeight: 600, cursor: 'pointer' }}>{action}</span>}
    </div>
  );
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ fontWeight: 700, color: T.text.primary, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.fill }}>{p.name}: {p.value}%</div>)}
    </div>
  );
}

const CSS = `
  .qlt-kpi  { display:grid; grid-template-columns:repeat(2,1fr); gap:10px }
  @media(min-width:1024px){ .qlt-kpi { grid-template-columns:repeat(4,1fr) } }
  .qlt-main { display:grid; grid-template-columns:1fr; gap:12px }
  @media(min-width:768px) { .qlt-main { grid-template-columns:1fr 1fr } }
  @media(min-width:1280px){ .qlt-main { grid-template-columns:1fr 1.8fr 1.3fr } }
  .qlt-kpi-val { font-size:22px }
  @media(min-width:480px){ .qlt-kpi-val { font-size:26px } }
`;

export default function QualityDashboard() {
  const { summary, recent, loading, error } = useQualityDashboardData();

  if (loading) {
    return (
      <div style={{ fontFamily: 'Inter, system-ui, sans-serif', background: T.bg, minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: T.text.secondary, fontSize: 14 }}>Loading quality data…</div>
      </div>
    );
  }

  if (error || !summary?.today) {
    return (
      <div style={{ fontFamily: 'Inter, system-ui, sans-serif', background: T.bg, minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: T.red.text, fontSize: 13 }}>Failed to load quality data{error ? `: ${error}` : ''}</div>
      </div>
    );
  }

  const today     = summary.today;
  const yesterday = summary.yesterday;
  const last9     = summary.last9 || [];

  // Sparklines from rolling 9-day data
  const passRateSpark = last9.map(d => d.qualityPassRate);
  const ncrSpark      = last9.map(d => d.openNcrs);
  const capaSpark     = last9.map(d => d.capaPending);
  const auditSpark    = last9.map(d => d.auditScore);

  // Deltas
  const passRateDelta  = yesterday != null ? today.qualityPassRate - yesterday.qualityPassRate : null;
  const ncrVsWeekAgo   = last9.length >= 2  ? today.openNcrs - last9[0].openNcrs : null;
  const auditDelta     = today.auditScore - today.prevAuditScore;

  const fmtSign = (v, decimals = 1) => v == null || isNaN(v) ? 'N/A' : `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}`;

  const kpiCards = [
    {
      label: 'Inspection Pass Rate',
      value: `${today.qualityPassRate.toFixed(1)}%`,
      delta: passRateDelta != null ? `${fmtSign(passRateDelta)}% vs yesterday` : 'no prior data',
      pos:   passRateDelta == null || passRateDelta >= 0,
      spark: passRateSpark,
      color: T.green.solid, bg: T.green.light,
    },
    {
      label: 'Open NCRs',
      value: `${today.openNcrs}`,
      delta: ncrVsWeekAgo != null ? `${fmtSign(ncrVsWeekAgo, 0)} vs last week` : 'no prior data',
      pos:   ncrVsWeekAgo == null || ncrVsWeekAgo <= 0,
      spark: ncrSpark,
      color: T.amber.solid, bg: T.amber.light,
    },
    {
      label: 'CAPA Pending',
      value: `${today.capaPending}`,
      delta: `${today.capaCritical} critical, ${today.capaMajor} major`,
      pos:   today.capaCritical === 0,
      spark: capaSpark,
      color: T.red.solid, bg: T.red.light,
    },
    {
      label: 'Audit Score',
      value: `${today.auditScore.toFixed(1)}%`,
      delta: `${fmtSign(auditDelta)}% vs last audit`,
      pos:   auditDelta >= 0,
      spark: auditSpark,
      color: T.blue.solid, bg: T.blue.light,
    },
  ];

  // Deviation severity breakdown
  const devTotal = (today.deviationCritical + today.deviationMajor + today.deviationMinor) || 1;
  const deviations = [
    { label: 'Critical', count: today.deviationCritical, pct: Math.round(today.deviationCritical / devTotal * 100), color: T.red.solid,   bg: T.red.light   },
    { label: 'Major',    count: today.deviationMajor,    pct: Math.round(today.deviationMajor    / devTotal * 100), color: T.amber.solid, bg: T.amber.light },
    { label: 'Minor',    count: today.deviationMinor,    pct: Math.round(today.deviationMinor    / devTotal * 100), color: T.green.solid, bg: T.green.light },
  ];

  // 7-day pass/fail trend (last 7 of last9)
  const trendData = last9.slice(-7).map(d => ({
    day:  new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
    pass: parseFloat(d.qualityPassRate.toFixed(1)),
    fail: parseFloat((100 - d.qualityPassRate).toFixed(1)),
  }));

  // Upcoming audits with priority color
  const upcomingAudits = (today.upcomingAudits || []).map(a => {
    const p = (a.priority || '').toLowerCase();
    const col = p === 'high' ? T.red : p === 'medium' ? T.amber : T.blue;
    return { ...a, color: col.solid, bg: col.light };
  });

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', background: T.bg, minHeight: '100%' }}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: '#fff', borderBottom: `1px solid ${T.border}`, padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: T.green.light, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={T.green.solid} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.text.primary }}>Quality Assurance</div>
            <div style={{ fontSize: 10.5, color: T.text.muted }}>QC & Compliance Dashboard</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, color: T.text.muted }}>{summary.latestDate}</span>
          <div style={{ fontSize: 10.5, color: T.green.text, background: T.green.light, padding: '4px 10px', borderRadius: 20, fontWeight: 600 }}>● Live</div>
        </div>
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* KPI row */}
        <div className="qlt-kpi">
          {kpiCards.map((k) => (
            <Card key={k.label} style={{ padding: '14px 16px 12px', position: 'relative', overflow: 'hidden', cursor: 'pointer' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.color, borderRadius: '12px 12px 0 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 4, marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: T.text.secondary, fontWeight: 500, maxWidth: '55%', lineHeight: 1.4 }}>{k.label}</span>
                <Sparkline data={k.spark} color={k.color} />
              </div>
              <div style={{ marginBottom: 8 }}>
                <span className="qlt-kpi-val" style={{ fontWeight: 800, color: T.text.primary, letterSpacing: '-0.03em' }}>{k.value}</span>
              </div>
              <div style={{ height: 1, background: T.border, marginBottom: 8 }} />
              <div style={{ fontSize: 11, color: k.pos ? T.green.text : T.red.text, fontWeight: 600 }}>
                {k.pos ? '↑' : '⚠'} {k.delta}
              </div>
            </Card>
          ))}
        </div>

        {/* Main row */}
        <div className="qlt-main">

          {/* Deviation severity + Upcoming Audits */}
          <Card style={{ padding: '16px 18px' }}>
            <SectionTitle>Deviation by Severity</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {deviations.map((d) => (
                <div key={d.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 12, color: T.text.secondary, fontWeight: 500 }}>{d.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: T.text.primary }}>{d.count}</span>
                      <span style={{ fontSize: 10, color: d.color, background: d.bg, padding: '1px 6px', borderRadius: 6, fontWeight: 600 }}>{d.pct}%</span>
                    </div>
                  </div>
                  <div style={{ height: 5, borderRadius: 4, background: '#eef0f5', overflow: 'hidden' }}>
                    <div style={{ width: `${d.pct}%`, height: '100%', background: d.color, borderRadius: 4, transition: 'width 0.4s' }} />
                  </div>
                </div>
              ))}
            </div>

            {upcomingAudits.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <SectionTitle action="Schedule →">Upcoming Audits</SectionTitle>
                {upcomingAudits.map((a) => (
                  <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: a.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: T.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
                      <div style={{ fontSize: 10, color: T.text.muted }}>{a.dept} · {fmtDate(a.date)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Pass/Fail trend */}
          <Card style={{ padding: '16px 18px' }}>
            <SectionTitle>Inspection Score Trend (7 Days)</SectionTitle>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={trendData} barCategoryGap="22%" barGap={3} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: T.text.muted }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: T.text.muted }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                  <Bar dataKey="pass" name="Pass %" fill={T.green.solid} radius={[4,4,0,0]} />
                  <Bar dataKey="fail" name="Fail %" fill={T.red.solid} radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.text.muted, fontSize: 13 }}>No trend data available</div>
            )}
          </Card>

          {/* Recent inspections */}
          <Card style={{ padding: '16px 18px' }}>
            <SectionTitle action="View All →">Recent Inspections</SectionTitle>
            {recent.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {recent.map((r, i) => {
                  const rs = resultStyle(r.inspection_result);
                  return (
                    <div key={r.batch_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: i < recent.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11.5, fontWeight: 600, color: T.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.product_name}</div>
                        <div style={{ fontSize: 10, color: T.text.muted, marginTop: 2 }}>{r.batch_id} · {r.inspection_stage}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: T.text.primary }}>{r.inspection_score}</div>
                        <span style={{ fontSize: 10, fontWeight: 600, color: rs.color, background: rs.bg, padding: '1px 6px', borderRadius: 6 }}>{r.inspection_result}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: T.text.muted, fontSize: 13 }}>No recent inspection records</div>
            )}
          </Card>

        </div>
      </div>
    </div>
  );
}
