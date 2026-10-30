import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import AuthShell from './AuthShell';
import { ClayButton, ErrorBanner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { errMsg } from '../api/client';

export default function Register() {
  const { user, register } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const next = searchParams.get('next') || '/dashboard';

  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

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
      await register(form.name, form.email, form.password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create an account"
      subtitle="Citizen accounts can report incidents. An administrator verifies each report."
    >
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
          <label className="label" htmlFor="name">Name</label>
          <input
            id="name"
            required
            className="neu-field"
            value={form.name}
            onChange={set('name')}
          />
        </div>
        <div>
          <label className="label" htmlFor="remail">Email</label>
          <input
            id="remail"
            type="email"
            required
            className="neu-field"
            value={form.email}
            onChange={set('email')}
          />
        </div>
        <div>
          <label className="label" htmlFor="rpass">Password</label>
          <input
            id="rpass"
            type="password"
            minLength={6}
            required
            className="neu-field"
            value={form.password}
            onChange={set('password')}
          />
          <p className="mt-1.5 text-xs text-ink-faint">At least 6 characters.</p>
        </div>
        <ClayButton type="submit" loading={busy} className="w-full">
          Create account
        </ClayButton>
      </form>
      <p className="mt-7 text-sm text-ink-soft">
        Already registered?{' '}
        <Link
          to={next !== '/dashboard' ? `/login?next=${encodeURIComponent(next)}` : '/login'}
          className="font-bold text-sky-deep hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
