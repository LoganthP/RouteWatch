import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Backdrop from './components/Backdrop';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import { useAuth } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';

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

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner label="Loading page..." />
    </div>
  );
}

function Protected({ children, admin }) {
  const { user, ready, isAdmin } = useAuth();
  if (!ready) return <div className="grid h-screen place-items-center"><Spinner label="Opening RouteWatch" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && !isAdmin) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user } = useAuth();
  return (
    <>
      <Backdrop />
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
            <Route path="/register" element={user ? <Navigate to="/" replace /> : <Register />} />
            <Route element={<Protected><Layout /></Protected>}>
              <Route index element={<Dashboard />} />
              <Route path="map" element={<LiveMap />} />
              <Route path="nearby" element={<Nearby />} />
              <Route path="report" element={<ReportIncident />} />
              <Route path="incidents" element={<Incidents />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="ai" element={<AIInsights />} />
              <Route path="query-lab" element={<QueryLab />} />
              <Route path="audit" element={<Protected admin><AuditLog /></Protected>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </>
  );
}
