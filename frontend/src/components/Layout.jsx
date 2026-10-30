import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  LayoutGrid, Map as MapIcon, Radar, FilePlus2, ListChecks, ChartColumnBig, Gauge, ScrollText, LogOut, Menu, X, BrainCircuit,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getSocket } from '../api/socket';
import ErrorBoundary from './ErrorBoundary';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutGrid, end: true },
  { to: '/map', label: 'Live map', icon: MapIcon },
  { to: '/nearby', label: 'Nearby search', icon: Radar },
  { to: '/report', label: 'Report incident', icon: FilePlus2 },
  { to: '/incidents', label: 'Incidents', icon: ListChecks },
  { to: '/analytics', label: 'Analytics', icon: ChartColumnBig },
  { to: '/ai', label: 'AI insights', icon: BrainCircuit },
  { to: '/query-lab', label: 'Query lab', icon: Gauge },
  { to: '/audit', label: 'Audit log', icon: ScrollText, admin: true },
];

export function Logo({ small }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`relative grid place-items-center ${small ? 'h-9 w-9' : 'h-11 w-11'}`}>
        <span className="absolute inset-[14%] rotate-45 rounded-[6px] border-[3px] border-ink bg-sun shadow-clay-sun" />
        <span className="relative h-[46%] w-[3px] rounded bg-ink" />
      </span>
      <span className="font-display text-xl font-extrabold tracking-tight">RouteWatch</span>
    </div>
  );
}

function NavItems({ onNavigate }) {
  const { isAdmin } = useAuth();
  return (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {NAV.filter((n) => !n.admin || isAdmin).map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} onClick={onNavigate}
          title={label}
          className={({ isActive }) =>
            `group relative flex items-center gap-3 rounded-2xl px-3.5 py-2 max-h-[720px]:py-1.5 text-[14.5px] font-semibold transition-colors ${
              isActive ? 'bg-white text-ink shadow-clay-white' : 'text-ink-soft hover:bg-white/50 hover:text-ink'
            }`}>
          {({ isActive }) => (
            <>
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl transition-colors ${isActive ? 'bg-sky text-white shadow-clay' : 'bg-white/70 text-ink-soft group-hover:text-sky'}`}>
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="truncate">{label}</span>
              {isActive && <span className="lane absolute bottom-1.5 left-[3.6rem] right-4 h-[3px] opacity-80" />}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function UserCard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      localStorage.removeItem('rw_token');
      navigate('/login');
    }
  };

  return (
    <div data-testid="sidebar-user-card" className="flex items-center gap-2.5 rounded-2xl bg-white/70 p-2.5 shadow-clay-white box-border w-full">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-lilac-soft font-display text-base font-bold text-lilac">
        {user?.name?.[0]?.toUpperCase() || 'U'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-ink" title={user?.name}>{user?.name || 'User'}</p>
        <p className="truncate text-xs font-semibold capitalize text-ink-soft">{user?.role || 'user'}</p>
      </div>
      <button
        onClick={handleLogout}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-ink-soft hover:bg-coral-soft hover:text-coral transition-colors"
        aria-label="Sign out"
        title="Sign out"
        data-testid="logout-btn"
      >
        <LogOut className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}

export default function Layout() {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const loc = useLocation();

  // Live updates: toast + broadcast a refresh event to the active page
  useEffect(() => {
    const s = getSocket();
    const fire = (detail) => window.dispatchEvent(new CustomEvent('rw:incident', { detail }));
    const onNew = (d) => {
      toast(`New ${String(d?.type || 'incident').toLowerCase()} reported in ${d?.area || 'an unnamed area'}`, 'info');
      fire({ kind: 'new', incident: d });
    };
    const onChange = (d) => fire({ kind: 'change', incident: d });
    const onIncidentsChanged = (d) => {
      fire({ kind: 'incidents:changed', ...d });
      window.dispatchEvent(new CustomEvent('rw:incidents:changed', { detail: d }));
    };
    const onImported = (d) => {
      if (d?.status === 'completed') toast(`Dataset "${d.name}" imported: ${Number(d.imported || 0).toLocaleString('en-IN')} incidents`, 'success');
      fire({ kind: 'dataset', dataset: d });
    };
    const onProgress = (d) => window.dispatchEvent(new CustomEvent('rw:dataset-progress', { detail: d }));
    const onDsDeleted = (d) => { fire({ kind: 'dataset-deleted', dataset: d }); onProgress({ ...d, status: 'deleted' }); };

    s.on('incident:new', onNew);
    s.on('incident:updated', onChange);
    s.on('incident:deleted', onChange);
    s.on('incidents:changed', onIncidentsChanged);
    s.on('dataset:imported', onImported);
    s.on('dataset:progress', onProgress);
    s.on('dataset:deleted', onDsDeleted);
    return () => {
      s.off('incident:new', onNew);
      s.off('incident:updated', onChange);
      s.off('incident:deleted', onChange);
      s.off('incidents:changed', onIncidentsChanged);
      s.off('dataset:imported', onImported);
      s.off('dataset:progress', onProgress);
      s.off('dataset:deleted', onDsDeleted);
    };
  }, [toast]);

  useEffect(() => setOpen(false), [loc.pathname]);

  return (
    <div className="flex min-h-full">
      {/* desktop sidebar: sticky, height: calc(100dvh - 2 * gap), flex-col, perfectly contained */}
      <aside data-testid="sidebar-container" className="sticky top-4 hidden h-[calc(100dvh-2rem)] w-[17.5rem] shrink-0 pl-4 py-1 lg:block box-border">
        <div data-testid="sidebar-glass" className="glass flex h-full flex-col p-3.5 box-border overflow-hidden">
          <div className="flex-none px-1.5 py-1.5"><Logo /></div>
          <div className="flex-1 min-h-0 my-2 overflow-y-auto pr-1 scrollbar-thin">
            <NavItems />
          </div>
          <div className="flex-none mt-auto pt-2">
            <UserCard />
          </div>
        </div>
      </aside>

      {/* mobile top bar + drawer */}
      <div className="fixed inset-x-3 top-3 z-[1100] lg:hidden">
        <div className="glass-strong flex items-center justify-between px-4 py-2.5">
          <Logo small />
          <button onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl bg-white shadow-clay-white" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <>
            <motion.div className="fixed inset-0 z-[1200] bg-ink/20 backdrop-blur-sm lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.aside
              data-testid="sidebar-container"
              className="fixed bottom-3 left-3 top-3 z-[1300] w-[17rem] lg:hidden box-border"
              initial={{ x: '-110%' }} animate={{ x: 0 }} exit={{ x: '-110%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}>
              <div data-testid="sidebar-glass" className="glass-strong flex h-full flex-col p-3.5 box-border overflow-hidden">
                <div className="flex-none flex items-center justify-between px-1.5 pt-1">
                  <Logo small />
                  <button onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white" aria-label="Close menu"><X className="h-5 w-5" /></button>
                </div>
                <div className="flex-1 min-h-0 my-2 overflow-y-auto pr-1 scrollbar-thin">
                  <NavItems onNavigate={() => setOpen(false)} />
                </div>
                <div className="flex-none mt-auto pt-2">
                  <UserCard />
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="min-w-0 flex-1 px-4 pb-10 pt-24 sm:px-6 lg:px-8 lg:pt-8">
        <ErrorBoundary resetKey={loc.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
