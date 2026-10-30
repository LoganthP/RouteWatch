import { useEffect, useState } from 'react';
import { Radio, AlertTriangle } from 'lucide-react';
import { SEV_COLOR } from '../../lib/constants';

export default function LiveTicker({ initialItems = [] }) {
  const [items, setItems] = useState(initialItems);

  useEffect(() => {
    if (initialItems && initialItems.length > 0) {
      setItems(initialItems);
    }
  }, [initialItems]);

  // Fallback items if database or network hasn't loaded yet
  const displayItems = items && items.length > 0 ? items : [
    { type: 'Hazard', area: 'Mumbai Central', severity: 'High', reportedAt: '12m ago' },
    { type: 'Accident', area: 'Devaraja Mohalla', severity: 'Critical', reportedAt: '18m ago' },
    { type: 'Congestion', area: 'London Central', severity: 'Medium', reportedAt: '25m ago' },
    { type: 'Road Closure', area: 'Mysuru Ring Road', severity: 'High', reportedAt: '32m ago' },
    { type: 'Hazard', area: 'North Highway Sector 4', severity: 'Medium', reportedAt: '45m ago' },
  ];

  // Duplicate items array so the ticker loops seamlessly
  const tickerItems = [...displayItems, ...displayItems];

  return (
    <aside
      aria-label="Real-time anonymised incident ticker"
      className="relative z-20 my-6 border-y-2 border-sun/30 bg-[#1E2A44] py-3.5 shadow-lift overflow-hidden"
    >
      <div className="flex items-center">
        {/* Fixed Marquee Badge */}
        <div className="relative z-10 flex shrink-0 items-center gap-2 bg-[#1E2A44] px-4 sm:px-6 shadow-md border-r border-white/10">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-coral opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-coral"></span>
          </span>
          <span className="font-display text-xs font-black uppercase tracking-wider text-sun">
            Live Traffic Wire
          </span>
        </div>

        {/* Marquee Track: pauses on hover */}
        <div className="group-hover-pause overflow-hidden whitespace-nowrap mask-fade">
          <div className="animate-marquee flex items-center gap-6 pr-6">
            {tickerItems.map((item, idx) => {
              const sevCol = SEV_COLOR[item.severity] || '#FFC93C';
              return (
                <div
                  key={`${item.id || item.type}-${idx}`}
                  className="inline-flex items-center gap-2.5 rounded-full bg-white/10 px-3.5 py-1.5 text-xs text-white backdrop-blur-sm border border-white/10 hover:bg-white/20 transition-colors"
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: sevCol }}
                  />
                  <span className="font-bold text-white tracking-wide">{item.type}</span>
                  <span className="text-white/40">•</span>
                  <span className="text-white/80">{item.area}</span>
                  <span className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] font-semibold text-sun">
                    {item.severity}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
