import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Backdrop from './components/Backdrop';
import { useAuth } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';

const Layout = lazy(() => import('./components/Layout'));
const Landing = lazy(() => import('./pages/Landing/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const LiveMap = lazy(() => import('./pages/LiveMap'));
const Nearby = lazy(() => import('./pages/Nearby'));
const ReportIncident = lazy(() => import('./pages/ReportIncident'));
const Incidents = lazy(() => import('./pages/Incidents'));
const Analytics = lazy(() => import('./pages/Analytics'));
const AIInsights = lazy(() => import('./pages/AIInsights'));
const QueryLab = lazy(() => import('./pages/QueryLab'));
const AuditLog = lazy(() => import('./pages/AuditLog'));

function PageLoader({ label = 'Loading page...' }) {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="grid place-items-center gap-2 py-10 text-ink-soft" role="status">
        <span className="h-7 w-7 rounded-full border-2 border-sky border-t-transparent animate-spin" />
        <span className="text-sm font-semibold">{label}</span>
      </div>
    </div>
  );
}

function Protected({ children, admin }) {
  const { user, ready, isAdmin } = useAuth();
  if (!ready) {
    return (
      <div className="grid h-screen place-items-center">
        <PageLoader label="Opening RouteWatch" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (admin && !isAdmin) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <>
      <Backdrop />
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Landing page for all users */}
            <Route path="/" element={<Landing />} />

            {/* Auth routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            {/* Protected dashboard & application routes */}
            <Route element={<Protected><Layout /></Protected>}>
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="map" element={<LiveMap />} />
              <Route path="nearby" element={<Nearby />} />
              <Route path="report" element={<ReportIncident />} />
              <Route path="incidents" element={<Incidents />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="ai" element={<AIInsights />} />
              <Route path="query-lab" element={<QueryLab />} />
              <Route path="audit" element={<Protected admin><AuditLog /></Protected>} />
            </Route>

            {/* Catch-all redirect to / */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </>
  );
}
