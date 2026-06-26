import React, { useState, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Truck, Package, Navigation, Archive } from 'lucide-react';
import useThemeStore from '../../store/useThemeStore';
import { getThemeTokens } from '../../utils/themeTokens';

const CARRIER_PERF = [
  { carrier: 'FastTrack',   efficiency: 96, deliveries: 42 },
  { carrier: 'MedExpress',  efficiency: 91, deliveries: 35 },
  { carrier: 'PharmaLogix', efficiency: 88, deliveries: 28 },
  { carrier: 'SwiftCargo',  efficiency: 84, deliveries: 19 },
];

let _sparkId = 0;
function Sparkline({ data, color }) {
  const id = useRef(`lspk-${_sparkId++}`).current;
  const w = 64, h = 32;
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

function ChartTip({ active, payload, label, T }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--surf)', border: '1px solid var(--brd)', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
      <div style={{ fontWeight: 700, color: 'var(--txt)', marginBottom: 4 }}>{label}</div>
      <div style={{ color: T.amber.text }}>{payload[0].value}% efficiency</div>
    </div>
  );
}

const CSS = `
  .log-kpi  { display:grid; grid-template-columns:repeat(2,1fr); gap:10px }
  @media(min-width:640px) { .log-kpi { grid-template-columns:repeat(4,1fr) } }
  .log-main { display:grid; grid-template-columns:1fr; gap:12px }
  @media(min-width:768px) { .log-main { grid-template-columns:1fr 1fr } }
  @media(min-width:1280px){ .log-main { grid-template-columns:1fr 1.4fr 1.8fr } }
  .log-kpi-val { font-size:22px }
  @media(min-width:480px){ .log-kpi-val { font-size:26px } }
`;

export default function LogisticsDashboard() {
  const { theme } = useThemeStore();
  const T = getThemeTokens(theme === 'dark');

  const KPI_CARDS = [
    { label: 'On-Time Delivery',  value: '92%', delta: '+3.4% vs last month', pos: true,  spark: [85,87,88,89,90,91,90,92,92], color: T.amber.solid,  bg: T.amber.light,  Icon: Truck      },
    { label: 'Pending Shipments', value: '23',  delta: '8 critical priority', pos: false, spark: [18,20,21,19,22,21,24,23,23], color: T.blue.solid,   bg: T.blue.light,   Icon: Package    },
    { label: 'In Transit',        value: '15',  delta: '2 delayed',           pos: false, spark: [10,12,11,13,14,13,15,15,15], color: T.purple.solid, bg: T.purple.light, Icon: Navigation },
    { label: 'Warehouse Fill %',  value: '78%', delta: '+4% vs last week',    pos: false, spark: [68,70,72,71,74,75,76,77,78], color: T.green.solid,  bg: T.green.light,  Icon: Archive    },
  ];

  const SHIPMENT_STATUS = [
    { label: 'Delivered',  count: 85, pct: 65, color: T.green.solid,  bg: T.green.light  },
    { label: 'In Transit', count: 15, pct: 11, color: T.blue.solid,   bg: T.blue.light   },
    { label: 'Pending',    count: 23, pct: 18, color: T.amber.solid,  bg: T.amber.light  },
    { label: 'Delayed',    count: 8,  pct: 6,  color: T.red.solid,    bg: T.red.light    },
  ];

  const UPCOMING_DELIVERIES = [
    { id: 'SHP-001', dest: 'City Hospital, Mumbai',      items: '500 units Amoxicillin',  due: 'Today 2 PM',    status: 'Out for Delivery', color: T.green.solid, bg: T.green.light  },
    { id: 'SHP-002', dest: 'Apollo Pharmacy, Delhi',     items: '1200 units Ibuprofen',   due: 'Today 5 PM',    status: 'Out for Delivery', color: T.green.solid, bg: T.green.light  },
    { id: 'SHP-003', dest: 'MedPlus Chain, Hyderabad',   items: '800 units Paracetamol',  due: 'Tomorrow 10 AM',status: 'In Transit',       color: T.blue.solid,  bg: T.blue.light   },
    { id: 'SHP-004', dest: 'Wellness Stores, Bangalore', items: '350 units Metformin',    due: 'Tomorrow 3 PM', status: 'Delayed',          color: T.red.solid,   bg: T.red.light    },
    { id: 'SHP-005', dest: 'Care Pharma, Chennai',       items: '1000 units Cetirizine',  due: 'Jun 25',        status: 'Pending',          color: T.amber.solid, bg: T.amber.light  },
  ];

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', background: 'var(--bg)', minHeight: '100%' }}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--surf)', borderBottom: '1px solid var(--brd)', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: T.amber.light, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={T.amber.solid} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--txt)' }}>Logistics & Supply Chain</div>
            <div style={{ fontSize: 10.5, color: 'var(--txt3)' }}>Shipment & Delivery Dashboard</div>
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
                <span style={{ fontSize: 11, color: 'var(--txt2)', fontWeight: 500, flex: 1, minWidth: 0, lineHeight: 1.4, paddingRight: 4 }}>{k.label}</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: k.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <k.Icon size={12} color={k.color} />
                  </div>
                  <Sparkline data={k.spark} color={k.color} />
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <span className="log-kpi-val" style={{ fontWeight: 800, color: 'var(--txt)', letterSpacing: '-0.03em' }}>{k.value}</span>
              </div>
              <div style={{ height: 1, background: 'var(--brd)', marginBottom: 8 }} />
              <div style={{ fontSize: 11, color: k.pos ? T.green.text : T.amber.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                    <span style={{ fontSize: 12, color: 'var(--txt2)', fontWeight: 500 }}>{s.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--txt)' }}>{s.count}</span>
                      <span style={{ fontSize: 10, color: s.color, background: s.bg, padding: '1px 6px', borderRadius: 6, fontWeight: 600 }}>{s.pct}%</span>
                    </div>
                  </div>
                  <div style={{ height: 5, borderRadius: 4, background: 'rgba(128,128,128,0.15)', overflow: 'hidden' }}>
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
                <XAxis type="number" domain={[75, 100]} tick={{ fontSize: 10, fill: 'var(--txt3)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="carrier" tick={{ fontSize: 11, fill: 'var(--txt2)', fontWeight: 500 }} axisLine={false} tickLine={false} width={70} />
                <Tooltip content={<ChartTip T={T} />} cursor={{ fill: 'rgba(128,128,128,0.06)' }} />
                <Bar dataKey="efficiency" fill={T.amber.solid} radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Upcoming deliveries */}
          <Card style={{ padding: '16px 18px' }}>
            <SectionTitle>Upcoming Deliveries</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {UPCOMING_DELIVERIES.map((d, i) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: i < UPCOMING_DELIVERIES.length - 1 ? '1px solid var(--brd)' : 'none' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.dest}</div>
                    <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.items} · Due {d.due}</div>
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
