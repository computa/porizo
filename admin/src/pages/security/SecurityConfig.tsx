import { useEffect, useState, useCallback } from 'react';
import { Settings, RefreshCw, Save, Clock, Lock, Gauge, AlertTriangle } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { useSaveToast } from '../../hooks/useSaveToast';

interface RateLimitDefault {
  limit: number;
  windowSeconds: number;
}

interface SecurityConfigData {
  sessionDurationHours: number;
  maxFailedLoginAttempts: number;
  lockoutDurationMinutes: number;
  rateLimitDefaults: Record<string, RateLimitDefault>;
}

const defaultConfig: SecurityConfigData = {
  sessionDurationHours: 8,
  maxFailedLoginAttempts: 5,
  lockoutDurationMinutes: 15,
  rateLimitDefaults: {
    enrollment_start: { limit: 3, windowSeconds: 86400 },
    render_preview: { limit: 20, windowSeconds: 86400 },
    track_create: { limit: 20, windowSeconds: 3600 },
  },
};

export function SecurityConfig() {
  const { get, put, loading, error } = useApi();
  const [config, setConfig] = useState<SecurityConfigData>(defaultConfig);
  const [saving, setSaving] = useState(false);
  const { saveSuccess, showSaveToast } = useSaveToast();
  const [hasChanges, setHasChanges] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const data = await get<SecurityConfigData>('/security/config');
      setConfig(data);
      setHasChanges(false);
    } catch {
      // Use defaults if config doesn't exist
      setConfig(defaultConfig);
    }
  }, [get]);

  useEffect(() => {
    fetchConfig().catch(console.error);
  }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await put('/security/config', config);
      showSaveToast();
      setHasChanges(false);
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = <K extends keyof SecurityConfigData>(
    key: K,
    value: SecurityConfigData[K]
  ) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const updateRateLimit = (actionType: string, field: keyof RateLimitDefault, value: number) => {
    setConfig(prev => ({
      ...prev,
      rateLimitDefaults: {
        ...prev.rateLimitDefaults,
        [actionType]: {
          ...prev.rateLimitDefaults[actionType],
          [field]: value,
        },
      },
    }));
    setHasChanges(true);
  };

  const formatActionType = (type: string) => {
    return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  const formatWindow = (seconds: number) => {
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)} day(s)`;
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)} hour(s)`;
    return `${Math.floor(seconds / 60)} minute(s)`;
  };

  const updatePasswordField = (field: 'currentPassword' | 'newPassword' | 'confirmPassword', value: string) => {
    setPasswordForm(prev => ({ ...prev, [field]: value }));
    setPasswordError(null);
    setPasswordSuccess(null);
  };

  const canSubmitPasswordChange =
    passwordForm.currentPassword.trim().length > 0 &&
    passwordForm.newPassword.length >= 8 &&
    passwordForm.confirmPassword.length >= 8 &&
    passwordForm.newPassword === passwordForm.confirmPassword &&
    passwordForm.newPassword !== passwordForm.currentPassword;

  const handleChangePassword = async () => {
    setPasswordError(null);
    setPasswordSuccess(null);

    if (passwordForm.newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }
    if (passwordForm.newPassword === passwordForm.currentPassword) {
      setPasswordError('New password must be different from current password.');
      return;
    }

    const token = localStorage.getItem('adminToken');
    if (!token) {
      window.location.href = '/admin/login';
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await fetch('/admin/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data?.message || data?.error || 'Failed to change password.';
        setPasswordError(message);
        return;
      }

      setPasswordSuccess('Password changed. You will be redirected to login.');
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminUser');
      setTimeout(() => {
        window.location.href = '/admin/login';
      }, 1200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change password.';
      setPasswordError(message);
    } finally {
      setPasswordSaving(false);
    }
  };

  if (loading && !config) {
    return <LoadingState message="Loading security config..." />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
            <Settings className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Security Config</h1>
            <p className="text-sm text-slate-400">Manage security settings and rate limits</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchConfig().catch(console.error)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              hasChanges
                ? 'bg-rose-500 hover:bg-rose-600 text-white'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            <Save className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} />
            {saving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Success Message */}
      {saveSuccess && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <span className="text-sm text-emerald-300">Security configuration saved successfully.</span>
        </div>
      )}

      {/* Session Settings */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-slate-400" />
          Session Settings
        </h2>
        <div className="grid grid-cols-1 gap-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Session Duration (hours)
            </label>
            <input
              type="number"
              min={1}
              max={720}
              value={config.sessionDurationHours}
              onChange={(e) => updateConfig('sessionDurationHours', parseInt(e.target.value) || 8)}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
            />
            <p className="text-xs text-slate-500 mt-1">How long admin sessions remain valid</p>
          </div>
        </div>
      </div>

      {/* Lockout Settings */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Lock className="w-5 h-5 text-slate-400" />
          Lockout Settings
        </h2>
        <div className="grid grid-cols-2 gap-6 max-w-2xl">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Max Failed Login Attempts
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={config.maxFailedLoginAttempts}
              onChange={(e) => updateConfig('maxFailedLoginAttempts', parseInt(e.target.value) || 5)}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
            />
            <p className="text-xs text-slate-500 mt-1">Failed attempts before account lockout</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Lockout Duration (minutes)
            </label>
            <input
              type="number"
              min={1}
              max={1440}
              value={config.lockoutDurationMinutes}
              onChange={(e) => updateConfig('lockoutDurationMinutes', parseInt(e.target.value) || 15)}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
            />
            <p className="text-xs text-slate-500 mt-1">How long accounts remain locked</p>
          </div>
        </div>
      </div>

      {/* Rate Limit Defaults */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Gauge className="w-5 h-5 text-slate-400" />
          Rate Limit Defaults
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Action Type</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Limit</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Window (seconds)</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Readable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {Object.entries(config.rateLimitDefaults).map(([actionType, limits]) => (
                <tr key={actionType} className="hover:bg-slate-800/30">
                  <td className="py-3 px-4 text-sm text-slate-200">
                    {formatActionType(actionType)}
                  </td>
                  <td className="py-3 px-4">
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={limits.limit}
                      onChange={(e) => updateRateLimit(actionType, 'limit', parseInt(e.target.value) || 1)}
                      className="w-24 bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                    />
                  </td>
                  <td className="py-3 px-4">
                    <select
                      value={limits.windowSeconds}
                      onChange={(e) => updateRateLimit(actionType, 'windowSeconds', parseInt(e.target.value))}
                      className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                    >
                      <option value={60}>60 (1 min)</option>
                      <option value={300}>300 (5 min)</option>
                      <option value={3600}>3600 (1 hour)</option>
                      <option value={21600}>21600 (6 hours)</option>
                      <option value={86400}>86400 (24 hours)</option>
                      <option value={604800}>604800 (7 days)</option>
                    </select>
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-400">
                    {limits.limit} per {formatWindow(limits.windowSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Password Change */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Lock className="w-5 h-5 text-slate-400" />
          Change Dashboard Password
        </h2>
        <p className="text-sm text-slate-400 mb-4">
          This updates your admin account password and signs out all active sessions for this account.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Current Password
            </label>
            <input
              type="password"
              value={passwordForm.currentPassword}
              onChange={(e) => updatePasswordField('currentPassword', e.target.value)}
              autoComplete="current-password"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
              placeholder="Current password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              New Password
            </label>
            <input
              type="password"
              value={passwordForm.newPassword}
              onChange={(e) => updatePasswordField('newPassword', e.target.value)}
              autoComplete="new-password"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Confirm New Password
            </label>
            <input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(e) => updatePasswordField('confirmPassword', e.target.value)}
              autoComplete="new-password"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
              placeholder="Repeat new password"
            />
          </div>
        </div>

        {passwordError && (
          <div className="mt-4 flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span className="text-sm text-rose-300">{passwordError}</span>
          </div>
        )}

        {passwordSuccess && (
          <div className="mt-4 flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
            <span className="text-sm text-emerald-300">{passwordSuccess}</span>
          </div>
        )}

        <div className="mt-4">
          <button
            onClick={handleChangePassword}
            disabled={passwordSaving || !canSubmitPasswordChange}
            className={`px-4 py-2 rounded-lg transition-colors ${
              canSubmitPasswordChange
                ? 'bg-rose-500 hover:bg-rose-600 text-white'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            {passwordSaving ? 'Updating...' : 'Change Password'}
          </button>
        </div>
      </div>

      {/* Unsaved Changes Warning */}
      {hasChanges && (
        <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span className="text-sm text-amber-300">You have unsaved changes. Click "Save Changes" to apply.</span>
        </div>
      )}
    </div>
  );
}
