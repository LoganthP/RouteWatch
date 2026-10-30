import { useEffect, useRef, useState } from 'react';
import { useScrollProgress } from '../../hooks/useLandingMotion';
import { CarFront } from 'lucide-react';

/**
 * Winding continuous road that travels down the page behind or beside sections.
 * Centers dashes animate with scroll progress, and a car drives along the road.
 */
export default function WindingRoad({ containerRef }) {
  const progress = useScrollProgress();
  const pathRef = useRef(null);
  const [carPos, setCarPos] = useState({ x: 30, y: 50, angle: 90 });

  // Update car position along the SVG path based on scroll progress
  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;

    try {
      const length = path.getTotalLength();
      const distance = Math.min(length, Math.max(0, length * progress));
      const pt = path.getPointAtLength(distance);
      // Sample ahead for rotation angle
      const lookAhead = Math.min(length, distance + 8);
      const ptAhead = path.getPointAtLength(lookAhead);
      const angle = (Math.atan2(ptAhead.y - pt.y, ptAhead.x - pt.x) * 180) / Math.PI;

      setCarPos({ x: pt.x, y: pt.y, angle });
    } catch {
      // Path not ready or SVG measurement unavailable
    }
  }, [progress]);

  // Dash offset moves as you scroll
  const dashOffset = -(progress * 800);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden hidden lg:block"
    >
      <svg
        className="h-full w-full"
        viewBox="0 0 1440 4800"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="roadGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3B4A6B" stopOpacity="0.8" />
            <stop offset="50%" stopColor="#2A3854" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#1E2A44" stopOpacity="1" />
          </linearGradient>
          <filter id="roadShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="8" stdDeviation="12" floodColor="#162036" floodOpacity="0.25" />
          </filter>
        </defs>

        {/* Outer road border */}
        <path
          d="M 180 0 C 350 500, 1150 700, 1220 1200 C 1280 1650, 200 1900, 180 2500 C 160 3000, 1260 3300, 1200 3900 C 1140 4350, 720 4550, 720 4800"
          fill="none"
          stroke="#1E2A44"
          strokeWidth="48"
          strokeLinecap="round"
          filter="url(#roadShadow)"
        />

        {/* Main Navy Road Ribbon */}
        <path
          d="M 180 0 C 350 500, 1150 700, 1220 1200 C 1280 1650, 200 1900, 180 2500 C 160 3000, 1260 3300, 1200 3900 C 1140 4350, 720 4550, 720 4800"
          fill="none"
          stroke="url(#roadGrad)"
          strokeWidth="40"
          strokeLinecap="round"
        />

        {/* Animated Yellow Dashed Center Line */}
        <path
          ref={pathRef}
          d="M 180 0 C 350 500, 1150 700, 1220 1200 C 1280 1650, 200 1900, 180 2500 C 160 3000, 1260 3300, 1200 3900 C 1140 4350, 720 4550, 720 4800"
          fill="none"
          stroke="#FFC93C"
          strokeWidth="4"
          strokeDasharray="28 20"
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />

        {/* Traveling Car Marker */}
        <g
          transform={`translate(${carPos.x}, ${carPos.y}) rotate(${carPos.angle})`}
          className="transition-transform duration-75"
        >
          {/* Car body */}
          <rect x="-18" y="-11" width="36" height="22" rx="6" fill="#1E2A44" stroke="#FFC93C" strokeWidth="2.5" />
          {/* Headlights */}
          <circle cx="16" cy="-6" r="2.5" fill="#FFF3CC" />
          <circle cx="16" cy="6" r="2.5" fill="#FFF3CC" />
          {/* Windshield */}
          <rect x="-4" y="-7" width="10" height="14" rx="2" fill="#8CCBFF" opacity="0.9" />
          {/* Taillights */}
          <rect x="-17" y="-8" width="2" height="4" fill="#FF4D6D" />
          <rect x="-17" y="4" width="2" height="4" fill="#FF4D6D" />
        </g>
      </svg>
    </div>
  );
}

