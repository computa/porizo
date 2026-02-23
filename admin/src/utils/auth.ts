/**
 * Shared admin authentication utilities.
 */

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

export function getAdminUser(): AdminUser | null {
  try {
    const stored = localStorage.getItem('adminUser');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}
