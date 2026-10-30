import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck, User, ArrowLeft } from 'lucide-react';
import AuthShell from './AuthShell';
import { ClayButton, ErrorBanner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { errMsg } from '../api/client';

const DEMO = [
  { label: 'Admin demo', email: 'admin@routewatch.local', password: 'Admin@123', icon: ShieldCheck },
  { label: 'Citizen demo', email: 'user@routewatch.local', password: 'User@123', icon: User },
];

export default function Login() {
  const { user, login } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const next = searchParams.get('next') || '/dashboard';

  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // If already logged in, honor ?next or redirect to /dashboard
  useEffect(() => {
    if (user) {
      navigate(next, { replace: true });
    }
  }, [user, next, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(form.email, form.password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in" subtitle="Use your account, or one of the seeded demo accounts.">
      <div className="mb-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-soft hover:text-ink transition-colors focus-visible:outline-sky"
          aria-label="Back to home"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          ← Back to home
        </Link>
      </div>

      <ErrorBanner message={error} />
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            className="neu-field"
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            className="neu-field"
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <ClayButton type="submit" loading={busy} className="w-full">
          Sign in
        </ClayButton>
      </form>

      <div className="mt-7">
        <p className="label">Fill in a demo account</p>
        <div className="grid grid-cols-2 gap-3">
          {DEMO.map(({ label, email, password, icon: Icon }) => (
            <ClayButton
              key={email}
              type="button"
              variant="white"
              size="sm"
              onClick={() => setForm({ email, password })}
            >
              <Icon className="h-4 w-4 text-sky" /> {label}
            </ClayButton>
          ))}
        </div>
      </div>

      <p className="mt-7 text-sm text-ink-soft">
        New here?{' '}
        <Link
          to={next !== '/dashboard' ? `/register?next=${encodeURIComponent(next)}` : '/register'}
          className="font-bold text-sky-deep hover:underline"
        >
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
