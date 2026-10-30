import { motion } from 'framer-motion';
import { Logo } from '../components/Layout';

/** Split auth screen: a road-themed illustration panel + a glass form card */
export default function AuthShell({ title, subtitle, children }) {
  return (
    <div className="grid min-h-screen place-items-center p-4 sm:p-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[36px] border border-white/80 bg-white/40 shadow-lift backdrop-blur-2xl lg:grid-cols-[1.05fr_1fr]">
        {/* illustration: a bright road with lane markings and incident signs */}
        <div className="relative hidden min-h-[560px] overflow-hidden bg-gradient-to-br from-[#8CCBFF] via-[#B9E2FF] to-[#FFE79A] p-10 lg:block">
          <Logo />
          <div className="relative z-10 mt-14 max-w-sm">
            <h2 className="text-[2.6rem] font-extrabold leading-[1.05] text-ink">See where the roads keep going wrong.</h2>
            <p className="mt-4 text-[17px] leading-relaxed text-ink/75">
              Report incidents, search what's nearby, and find the hotspots hiding in a year of traffic history.
            </p>
          </div>
          <svg className="absolute -bottom-6 -right-10 w-[120%]" viewBox="0 0 600 300" aria-hidden>
            <path d="M-20 300 C 160 220, 260 210, 640 60 L 640 170 C 330 270, 220 290, 120 320 Z" fill="#3B4A6B" />
            <path d="M40 300 C 200 235, 300 215, 640 110" fill="none" stroke="#FFC93C" strokeWidth="6" strokeDasharray="26 18" strokeLinecap="round" />
            {[[150, 228, '#FF4D6D'], [330, 178, '#FFC93C'], [500, 128, '#2BD9A6']].map(([x, y, c]) => (
              <g key={x} transform={`translate(${x} ${y - 70})`}>
                <rect x="-3" y="30" width="6" height="40" rx="3" fill="#1E2A44" />
                <rect x="-18" y="-4" width="36" height="36" rx="6" transform="rotate(45 0 14)" fill={c} stroke="#1E2A44" strokeWidth="4" />
              </g>
            ))}
          </svg>
        </div>

        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: 'spring', stiffness: 160, damping: 22 }}
          className="bg-white/70 p-7 sm:p-10"
        >
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h1 className="text-3xl font-extrabold">{title}</h1>
          <p className="mt-1.5 text-ink-soft">{subtitle}</p>
          <div className="lane my-6 w-24" />
          {children}
        </motion.div>
      </div>
    </div>
  );
}
