import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { isAuthenticated, loginRequest } from '../auth';

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (isAuthenticated()) {
    return <Navigate to="/dashboard/analytics" replace />;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await loginRequest(username, password);
      navigate('/dashboard/analytics', { replace: true });
    } catch (err) {
      setError(err?.message || 'Login failed. Check backend is running (port 369).');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-indigo-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="relative">
          <div className="absolute -inset-2 rounded-[28px] bg-gradient-to-r from-indigo-600/20 via-violet-600/20 to-fuchsia-600/20 blur-xl" />
          <div className="relative w-full bg-white border border-gray-100 rounded-[28px] shadow-sm overflow-hidden">
            <div className="p-7 flex items-center gap-3 border-b border-gray-100">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center font-bold">
                H
              </div>
              <div className="leading-tight">
                <div className="text-xs font-semibold text-gray-500">WhatsApp Lead Flow</div>
                <div className="text-sm font-bold text-gray-900">WhatsApp Lead Flow</div>
              </div>
            </div>

            <div className="p-7">
              <h1 className="text-2xl font-bold text-gray-900">Sign in</h1>
              <p className="text-sm text-gray-500 mt-1">
                Premium analytics and lead management
              </p>

              <form className="mt-6 space-y-4" onSubmit={onSubmit}>
                {error ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    {error}
                  </div>
                ) : null}
                <div>
                  <label
                    htmlFor="username"
                    className="block text-sm font-semibold text-gray-700 mb-1"
                  >
                    Username
                  </label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="block text-sm font-semibold text-gray-700 mb-1"
                  >
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-2xl bg-indigo-600 text-white py-2.5 font-semibold hover:bg-indigo-700 disabled:opacity-60"
                >
                  {loading ? 'Signing in…' : 'Login'}
                </button>
              </form>

              <div className="mt-5 text-xs text-gray-500">
                Demo credentials: <span className="font-semibold">admin</span> /{' '}
                <span className="font-semibold">admin</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

