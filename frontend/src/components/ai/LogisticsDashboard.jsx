import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const T = {
  bg: '#f0f2f7', surface: '#ffffff', border: '#e8eaf0',
  text: { primary: '#0f1117', secondary: '#5a6072', muted: '#9da3b4' },
  amber:  { solid: '#d97706', light: '#fef3c7', text: '#b45309' },
  blue:   { solid: '#2563eb', light: '#dbeafe', text: '#1d4ed8' },
  green:  { solid: '#16a34a', light: '#dcfce7', text: '#15803d' },
  red:    { solid: '#dc2626', light: '#fee2e2', text: '#b91c1c' },
  purple: { solid: '#7c3aed', light: '#ede9fe', text: '#6d28d9' },
  gray:   { solid: '#6b7280', light: '#f3f4f6', text: '#4b5563' },
};

const KPI_CARDS = [
  { label: 'On-Time Delivery',    value: '92%',  delta: '+3.4% vs last month', pos: true,  spark: [85,87,88,89,90,91,90,92,92], color: T.amber.solid,  bg: T.amber.light  },
  { label: 'Pending Shipments',   value: '23',   delta: '8 critical priority', pos: false, spark: [18,20,21,19,22,21,24,23,23], color: T.blue.solid,   bg: T.blue.light   },
  { label: 'In Transit',          value: '15',   delta: '2 delayed',           pos: false, spark: [10,12,11,13,14,13,15,15,15], color: T.purple.solid, bg: T.purple.light },
  { label: 'Warehouse Fill %',    value: '78%',  delta: '+4% vs last week',    pos: false, spark: [68,70,72,71,74,75,76,77,78], color: T.green.solid,  bg: T.green.light  },
];

const SHIPMENT_STATUS = [
  { label: 'Delivered',   count: 85, pct: 65, color: T.green.solid,  bg: T.green.light  },
  { label: 'In Transit',  count: 15, pct: 11, color: T.blue.solid,   bg: T.blue.light   },
  { label: 'Pending',     count: 23, pct: 18, color: T.amber.solid,  bg: T.amber.light  },
  { label: 'Delayed',     count: 8,  pct: 6,  color: T.red.solid,    bg: T.red.light    },
];

const CARRIER_PERF = [
  { carrier: 'FastTrack',    efficiency: 96, deliveries: 42 },
  { carrier: 'MedExpress',   efficiency: 91, deliveries: 35 },
  { carrier: 'PharmaLogix',  efficiency: 88, deliveries: 28 },
  { carrier: 'SwiftCargo',   efficiency: 84, deliveries: 19 },
];

const UPCOMING_DELIVERIES = [
  { id: 'SHP-20240622-001', dest: 'City Hospital, Mumbai',       items: '500 units Amoxicillin',   due: 'Today 2 PM',    status: 'Out for Delivery', color: T.green.solid,  bg: T.green.light  },
  { id: 'SHP-20240622-002', dest: 'Apollo Pharmacy, Delhi',      items: '1200 units Ibuprofen',    due: 'Today 5 PM',    status: 'Out for Delivery', color: T.green.solid,  bg: T.green.light  },
  { id: 'SHP-20240622-003', dest: 'MedPlus Chain, Hyderabad',    items: '800 units Paracetamol',   due: 'Tomorrow 10 AM',status: 'In Transit',       color: T.blue.solid,   bg: T.blue.light   },
  { id: 'SHP-20240622-004', dest: 'Wellness Stores, Bangalore',  items: '350 units Metformin',     due: 'Tomorrow 3 PM', status: 'Delayed',          color: T.red.solid,    bg: T.red.light    },
  { id: 'SHP-20240622-005', dest: 'Care Pharma, Chennai',        items: '1000 units Cetirizine',   due: 'Jun 25',        status: 'Pending',          color: T.amber.solid,  bg: T.amber.light  },
];

function Sparkline({ data, color }) {
  const w = 64, h = 28;
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
      <div style={{ color: T.amber.text }}>{payload[0].value}% efficiency</div>
    </div>
  );
}

const CSS = `
  .log-kpi  { display:grid; grid-template-columns:repeat(2,1fr); gap:10px }
  @media(min-width:1024px){ .log-kpi { grid-template-columns:repeat(4,1fr) } }
  .log-main { display:grid; grid-template-columns:1fr; gap:12px }
  @media(min-width:768px) { .log-main { grid-template-columns:1fr 1fr } }
  @media(min-width:1280px){ .log-main { grid-template-columns:1fr 1.4fr 1.8fr } }
  .log-kpi-val { font-size:22px }
  @media(min-width:480px){ .log-kpi-val { font-size:26px } }
`;

export default function LogisticsDashboard() {
  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', background: T.bg, minHeight: '100%' }}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: '#fff', borderBottom: `1px solid ${T.border}`, padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: T.amber.light, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={T.amber.solid} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.text.primary }}>Logistics & Supply Chain</div>
            <div style={{ fontSize: 10.5, color: T.text.muted }}>Shipment & Delivery Dashboard</div>
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: T.green.text, background: T.green.light, padding: '4px 10px', borderRadius: 20, fontWeight: 600 }}>● Live</div>
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* KPI row */}
        <div className="log-kpi">
          {KPI_CARDS.map((k) => (
            <Card key={k.label} style={{ padding: '14px 16px 12px', position: 'relative', overflow: 'hidden', cursor: 'pointer' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.color, borderRadius: '12px 12px 0 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 4, marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: T.text.secondary, fontWeight: 500, maxWidth: '55%', lineHeight: 1.4 }}>{k.label}</span>
                <Sparkline data={k.spark} color={k.color} />
              </div>
              <div style={{ marginBottom: 8 }}>
                <span className="log-kpi-val" style={{ fontWeight: 800, color: T.text.primary, letterSpacing: '-0.03em' }}>{k.value}</span>
              </div>
              <div style={{ height: 1, background: T.border, marginBottom: 8 }} />
              <div style={{ fontSize: 11, color: k.pos ? T.green.text : T.amber.text, fontWeight: 600 }}>
                {k.pos ? '↑' : '⚠'} {k.delta}
              </div>
            </Card>
          ))}
        </div>

        {/* Main row */}
        <div className="log-main">

          {/* Shipment status */}
          <Card style={{ padding: '16px 18px' }}>
            <SectionTitle>Shipment Status</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {SHIPMENT_STATUS.map((s) => (
                <div key={s.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 12, color: T.text.secondary, fontWeight: 500 }}>{s.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: T.text.primary }}>{s.count}</span>
                      <span style={{ fontSize: 10, color: s.color, background: s.bg, padding: '1px 6px', borderRadius: 6, fontWeight: 600 }}>{s.pct}%</span>
                    </div>
                  </div>
                  <div style={{ height: 5, borderRadius: 4, background: '#eef0f5', overflow: 'hidden' }}>
                    <div style={{ width: `${s.pct}%`, height: '100%', background: s.color, borderRadius: 4, transition: 'width 0.4s' }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Carrier performance chart */}
          <Card style={{ padding: '16px 18px' }}>
            <SectionTitle>Carrier Performance</SectionTitle>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={CARRIER_PERF} layout="vertical" barCategoryGap="25%" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
                <XAxis type="number" domain={[75, 100]} tick={{ fontSize: 10, fill: T.text.muted }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="carrier" tick={{ fontSize: 11, fill: T.text.secondary, fontWeight: 500 }} axisLine={false} tickLine={false} width={70} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="efficiency" fill={T.amber.solid} radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Upcoming deliveries */}
          <Card style={{ padding: '16px 18px' }}>
            <SectionTitle action="Track All →">Upcoming Deliveries</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {UPCOMING_DELIVERIES.map((d, i) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: i < UPCOMING_DELIVERIES.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: T.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.dest}</div>
                    <div style={{ fontSize: 10, color: T.text.muted, marginTop: 2 }}>{d.items} · Due {d.due}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: d.color, background: d.bg, padding: '2px 8px', borderRadius: 8, flexShrink: 0, whiteSpace: 'nowrap' }}>{d.status}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
