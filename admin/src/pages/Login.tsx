import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Music, KeyRound, AlertCircle } from 'lucide-react';

export function Login() {
  const [adminKey, setAdminKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/admin/dashboard/metrics/overview', {
        headers: { 'x-admin-key': adminKey },
      });

      if (res.status === 403) {
        setError('Invalid admin key');
        setLoading(false);
        return;
      }

      if (!res.ok) {
        const statusMessages: Record<number, string> = {
          404: 'Admin endpoint not found',
          429: 'Too many attempts. Please wait.',
          500: 'Server error. Try again later.',
          502: 'Server unavailable. Try again later.',
          503: 'Server unavailable. Try again later.',
        };
        setError(statusMessages[res.status] || `Error (${res.status})`);
        setLoading(false);
        return;
      }

      localStorage.setItem('adminKey', adminKey);
      navigate('/');
    } catch (err) {
      console.error('Login failed:', err);
      if (err instanceof TypeError) {
        setError('Network error. Check your connection.');
      } else {
        setError('Failed to connect to server');
      }
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-grid p-4">
      {/* Background glow effect */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-rose-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Card */}
        <div className="card rounded-2xl p-8">
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/20 flex items-center justify-center glow-rose mb-4">
              <Music className="w-8 h-8 text-rose-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">Porizo Admin</h1>
            <p className="text-slate-400 mt-1 text-sm">Mission Control Access</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Admin Key
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                <input
                  type="password"
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-slate-800/50 border border-slate-600/50 rounded-lg text-white placeholder-slate-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 transition-all"
                  placeholder="Enter admin key"
                  required
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/10 p-3 rounded-lg border border-rose-500/20">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-rose-500 hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-lg transition-all glow-rose-sm hover:glow-rose"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Authenticating...
                </span>
              ) : (
                'Access Dashboard'
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-slate-500 text-xs mt-6 font-data">
          Authorized personnel only
        </p>
      </div>
    </div>
  );
}
