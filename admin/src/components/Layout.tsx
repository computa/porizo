import { Outlet, Navigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function Layout() {
  const adminToken = localStorage.getItem('adminToken');

  if (!adminToken) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex min-h-screen bg-grid">
      <Sidebar />
      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
