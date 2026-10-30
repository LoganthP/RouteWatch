import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import Nav from './Nav';
import Hero from './Hero';
import LiveTicker from './LiveTicker';
import WindingRoad from './WindingRoad';
import ProblemSolution from './ProblemSolution';
import LiveDataStats from './LiveDataStats';
import Footer from './Footer';

// Code-split below-the-fold sections to optimize initial mobile TBT and LCP
const BentoGrid = lazy(() => import('./BentoGrid'));
const HowItWorks = lazy(() => import('./HowItWorks'));
const AISection = lazy(() => import('./AISection'));
const TechStack = lazy(() => import('./TechStack'));
const FAQSection = lazy(() => import('./FAQSection'));
const FinalCTA = lazy(() => import('./FinalCTA'));

export default function Landing() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const pageRef = useRef(null);

  useEffect(() => {
    // Fetch live public aggregated stats
    const controller = new AbortController();
    fetch('/api/public/stats', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('API unavailable');
        return res.json();
      })
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch(() => {
        // Tasteful fallback without crashing or displaying errors
        setStats(null);
        setLoading(false);
      });

    return () => controller.abort();
  }, []);

  return (
    <div ref={pageRef} className="relative min-h-screen text-ink selection:bg-sun selection:text-ink">
      {/* 1. Glass Sticky Nav */}
      <Nav />

      {/* 2. Hero Section */}
      <Hero stats={stats} />

      {/* 3. Live Ticker Strip */}
      <LiveTicker initialItems={stats?.recentTicker} />

      {/* Continuous Winding Road spine running behind sections */}
      <div className="relative">
        <WindingRoad containerRef={pageRef} />

        <main id="main-content" className="relative z-10">
          {/* 4. Problem -> Solution (Red Diamond Sign) */}
          <ProblemSolution />

          {/* 5. Features Bento Grid (Yellow Diamond Sign) */}
          <Suspense fallback={<div className="py-8" />}>
            <BentoGrid />
          </Suspense>

          {/* 6. Live Data Stats (4 count-up cards) */}
          <LiveDataStats stats={stats} loading={loading} />

          {/* 7. How It Works (Road Journey) */}
          <Suspense fallback={<div className="py-8" />}>
            <HowItWorks />
          </Suspense>

          {/* 8. AI Section (Green Diamond Sign) */}
          <Suspense fallback={<div className="py-8" />}>
            <AISection />
          </Suspense>

          {/* 9. Built With Tech Chips */}
          <Suspense fallback={<div className="py-8" />}>
            <TechStack />
          </Suspense>

          {/* 10. Accessible FAQ Accordion */}
          <Suspense fallback={<div className="py-8" />}>
            <FAQSection />
          </Suspense>

          {/* 11. Final Road-End CTA */}
          <Suspense fallback={<div className="py-8" />}>
            <FinalCTA />
          </Suspense>
        </main>
      </div>

      {/* 12. Footer with Lane Line Dashes */}
      <Footer />
    </div>
  );
}
