import { useState, useEffect } from 'react';
import { BrainCircuit, Sparkles, TrendingUp, Layers, CheckCircle } from 'lucide-react';
import DiamondSignStop from './DiamondSignStop';
import { useTilt } from '../../hooks/useLandingMotion';

export default function AISection() {
  const [tiltRef, tiltStyle] = useTilt(3);
  const [isLiveMl, setIsLiveMl] = useState(false);

  // Forecast data (7-day projection with confidence upper/lower band)
  const forecastDays = [
    { day: 'Day 1', actual: 44, forecast: 46, lower: 40, upper: 52 },
    { day: 'Day 2', actual: 52, forecast: 50, lower: 43, upper: 57 },
    { day: 'Day 3', actual: null, forecast: 68, lower: 58, upper: 78 }, // weekend spike
    { day: 'Day 4', actual: null, forecast: 74, lower: 62, upper: 86 },
    { day: 'Day 5', actual: null, forecast: 48, lower: 39, upper: 57 },
    { day: 'Day 6', actual: null, forecast: 45, lower: 37, upper: 53 },
    { day: 'Day 7', actual: null, forecast: 51, lower: 42, upper: 60 },
  ];

  useEffect(() => {
    fetch('/api/ml/health')
      .then((r) => r.json())
      .then((data) => {
        if (data.online) setIsLiveMl(true);
      })
      .catch(() => setIsLiveMl(false));
  }, []);

  return (
    <section id="ai" className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <DiamondSignStop
        mood="green"
        badge="Stop 05 • Machine Learning"
        title="Predictive road intelligence, grounded in evidence"
        subtitle="RouteWatch avoids hype: machine learning models only forecast what historical records statistically support."
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-center">
        {/* Left Column: What ML does */}
        <div className="space-y-6 lg:col-span-6">
          <div className="glass p-6 sm:p-7 shadow-glass">
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-mint text-white shadow-clay">
                <TrendingUp className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-display text-lg font-bold text-ink">
                  Incident Volume Forecasting
                </h3>
                <p className="mt-1 text-sm text-ink-soft leading-relaxed">
                  Applies Holt-Winters exponential smoothing to historical daily traffic volumes,
                  forecasting the next 7 days from seasonal cycles and day-of-week patterns.
                </p>
              </div>
            </div>
          </div>

          <div className="glass p-6 sm:p-7 shadow-glass">
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sun text-ink shadow-clay-sun">
                <BrainCircuit className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-display text-lg font-bold text-ink">
                  Severity Scoring (Random Forest)
                </h3>
                <p className="mt-1 text-sm text-ink-soft leading-relaxed">
                  A trained Random Forest classifier evaluates location, hour of the day,
                  and incident type to suggest severity levels (Low to Critical) at report time.
                </p>
              </div>
            </div>
          </div>

          <div className="glass p-6 sm:p-7 shadow-glass">
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky text-white shadow-clay">
                <Layers className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-display text-lg font-bold text-ink">
                  DBSCAN Spatial Density Clustering
                </h3>
                <p className="mt-1 text-sm text-ink-soft leading-relaxed">
                  Identifies arbitrarily shaped spatial clusters across roads and junctions
                  using metric geodesic distances (in meters), filtering random noise.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Animated Forecast Line Chart with Confidence Band */}
        <div className="lg:col-span-6">
          <div
            ref={tiltRef}
            style={tiltStyle}
            className="glass overflow-hidden p-6 sm:p-8 shadow-lift"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/60 pb-4">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                  7-Day Projected Hazard Curve
                </span>
                <h3 className="font-display text-xl font-extrabold text-ink">
                  Incident Volume Outlook
                </h3>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-extrabold shadow-sm ${
                  isLiveMl
                    ? 'bg-mint-soft text-mint-deep'
                    : 'bg-sun-soft text-[#8a4e00]'
                }`}
              >
                {isLiveMl ? 'Live Model Active' : 'Example Projection'}
              </span>
            </div>

            <p className="mt-3 text-xs font-semibold text-ink-soft">
              Forecasts next 7 days from historical patterns with 95% confidence intervals.
            </p>

            {/* SVG Forecast Chart */}
            <div className="mt-6 h-56 w-full">
              <svg viewBox="0 0 500 220" className="h-full w-full overflow-visible">
                <defs>
                  <linearGradient id="confidenceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2BD9A6" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#2BD9A6" stopOpacity="0.05" />
                  </linearGradient>
                </defs>

                {/* Gridlines */}
                {[40, 90, 140, 190].map((y) => (
                  <line
                    key={y}
                    x1="20"
                    y1={y}
                    x2="480"
                    y2={y}
                    stroke="#DFE8F5"
                    strokeDasharray="4 4"
                  />
                ))}

                {/* Confidence Band Polygon */}
                <polygon
                  points="
                    35,140 100,125 175,70 250,55 325,120 400,135 465,115
                    465,160 400,175 325,165 250,110 175,125 100,165 35,175
                  "
                  fill="url(#confidenceGrad)"
                />

                {/* Forecast Line */}
                <path
                  d="M 35 155 L 100 145 L 175 95 L 250 82 L 325 142 L 400 155 L 465 138"
                  fill="none"
                  stroke="#2BD9A6"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />

                {/* Actual Historical Line (First 2 days) */}
                <path
                  d="M 35 158 L 100 142"
                  fill="none"
                  stroke="#1E2A44"
                  strokeWidth="3"
                  strokeLinecap="round"
                />

                {/* Day data points */}
                {forecastDays.map((d, i) => {
                  const cx = 35 + i * 71.6;
                  const cy = [155, 145, 95, 82, 142, 155, 138][i];
                  return (
                    <g key={d.day}>
                      <circle
                        cx={cx}
                        cy={cy}
                        r="5"
                        fill={i < 2 ? '#1E2A44' : '#2BD9A6'}
                        stroke="#ffffff"
                        strokeWidth="2"
                      />
                      <text
                        x={cx}
                        y="212"
                        textAnchor="middle"
                        className="text-[11px] font-bold fill-[#5B6B8C]"
                      >
                        {d.day}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Legend */}
            <div className="mt-4 flex flex-wrap items-center justify-between text-xs font-semibold text-ink-soft border-t border-slate-200/80 pt-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-5 rounded bg-[#1E2A44]" />
                <span>Recorded history</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-5 rounded bg-mint" />
                <span>Holt-Winters projection</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-5 rounded bg-mint/30" />
                <span>Confidence range</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
