import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  AlertTriangle,
  Shield,
  CreditCard,
  Share2,
  LogOut,
  Music,
  User,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Overview' },
  { to: '/users', icon: Users, label: 'Users' },
  { to: '/jobs', icon: Briefcase, label: 'Jobs' },
  { to: '/dlq', icon: AlertTriangle, label: 'Dead Letter Queue' },
  { to: '/moderation', icon: Shield, label: 'Moderation' },
  { to: '/billing', icon: CreditCard, label: 'Billing' },
  { to: '/shares', icon: Share2, label: 'Shares' },
];

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

function getAdminUser(): AdminUser | null {
  try {
    const stored = localStorage.getItem('adminUser');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function Sidebar() {
  const adminUser = getAdminUser();

  const handleLogout = async () => {
    const token = localStorage.getItem('adminToken');

    // Call logout API to invalidate session server-side
    if (token) {
      try {
        await fetch('/admin/auth/logout', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });
      } catch {
        // Ignore errors - we're logging out anyway
      }
    }

    // Clear local storage
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    window.location.href = '/admin/login';
  };

  return (
    <aside className="w-64 bg-slate-900/80 backdrop-blur-xl border-r border-slate-700/50 min-h-screen p-4 flex flex-col">
      {/* Logo */}
      <div className="mb-8 px-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center glow-rose-sm">
            <Music className="w-5 h-5 text-rose-400" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Porizo</h1>
            <p className="text-xs text-slate-400 font-data">ADMIN</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1" aria-label="Main navigation">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group ${
                isActive
                  ? 'bg-rose-500/20 text-rose-400 glow-rose-sm'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`
            }
          >
            <Icon className="w-5 h-5" aria-hidden="true" />
            <span className="font-medium">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Status indicator and user info */}
      <div className="mt-auto pt-4 border-t border-slate-700/50">
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-glow" />
          <span className="font-data text-xs">System Online</span>
        </div>

        {/* Admin user info */}
        {adminUser && (
          <div className="flex items-center gap-3 px-3 py-2 mt-2">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
              <User className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">
                {adminUser.displayName || adminUser.email}
              </p>
              <p className="text-xs text-slate-500 truncate">{adminUser.email}</p>
            </div>
          </div>
        )}

        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 w-full mt-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800/50 rounded-lg transition-colors"
        >
          <LogOut className="w-5 h-5" aria-hidden="true" />
          <span className="font-medium">Logout</span>
        </button>
      </div>
    </aside>
  );
}
