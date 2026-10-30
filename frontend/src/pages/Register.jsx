import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthShell from './AuthShell';
import { ClayButton, ErrorBanner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { errMsg } from '../api/client';

export default function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await register(form.name, form.email, form.password); }
    catch (err) { setError(errMsg(err)); }
    finally { setBusy(false); }
  };

  return (
    <AuthShell title="Create an account" subtitle="Citizen accounts can report incidents. An administrator verifies each report.">
      <ErrorBanner message={error} />
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="name">Name</label>
          <input id="name" required className="neu-field" value={form.name} onChange={set('name')} />
        </div>
        <div>
          <label className="label" htmlFor="remail">Email</label>
          <input id="remail" type="email" required className="neu-field" value={form.email} onChange={set('email')} />
        </div>
        <div>
          <label className="label" htmlFor="rpass">Password</label>
          <input id="rpass" type="password" minLength={6} required className="neu-field" value={form.password} onChange={set('password')} />
          <p className="mt-1.5 text-xs text-ink-faint">At least 6 characters.</p>
        </div>
        <ClayButton type="submit" loading={busy} className="w-full">Create account</ClayButton>
      </form>
      <p className="mt-7 text-sm text-ink-soft">
        Already registered? <Link to="/login" className="font-bold text-sky-deep hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}
