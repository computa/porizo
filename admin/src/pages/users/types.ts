export interface User {
  id: string;
  email: string | null;
  email_status: 'verified' | 'unverified' | 'none' | 'legacy';
  auth_methods: string[];
  registration_status: 'registered' | 'guest' | 'unclaimed' | 'deleted';
  account_status: 'active' | 'guest';
  display_name: string | null;
  risk_level: string;
  locked_until: string | null;
  created_at: string;
  country: string | null;
  tier: string;
  track_count: number;
  gift_songs_used_total: number;
  voice_status: string;
  last_active: string;
  acquisition_source: string | null;
  acquisition_campaign: string | null;
  acquisition_country: string | null;
  attribution_status: string | null;
  attribution_reason: string | null;
  attribution_confidence: string | null;
}

export interface UserStats {
  totalUsers: number;
  paidUsers: number;
  trialUsers: number;
  freeUsers: number;
  guestUsers: number;
  unclaimedUsers: number;
  deletedUsers: number;
  conversionRate: string;
}

export interface UsersResponse {
  users: User[];
  total: number;
  limit: number;
  offset: number;
}

export interface BulkActionResponse {
  succeeded: string[];
  failed: Array<{ userId: string | null; error: string }>;
}

export interface UserDetail {
  user: {
    id: string;
    email: string | null;
    email_status: User['email_status'];
    auth_methods: string[];
    registration_status: User['registration_status'];
    account_status: User['account_status'];
    display_name: string | null;
    phone_number: string | null;
    risk_level: string;
    locked_until: string | null;
    created_at: string;
    country: string | null;
    acquisition_source: string | null;
    acquisition_campaign: string | null;
    acquisition_country: string | null;
    attribution_status: string | null;
    attribution_reason: string | null;
    attribution_confidence: string | null;
  };
  voiceProfile: {
    id: string;
    status: string;
    quality_score: number;
    created_at: string;
  } | null;
  entitlements: {
    tier: string;
    preview_count_today: number;
  } | null;
  subscription: {
    id: string;
    status: string;
    plan_id: string;
    expires_at: string | null;
    created_at: string;
  } | null;
  attribution: {
    id: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    country: string | null;
    referrer_url: string | null;
    created_at: string;
  } | null;
  tracks: Array<{
    id: string;
    title: string;
    occasion: string;
    status: string;
    created_at: string;
  }>;
  shares: Array<{
    id: string;
    status: string;
    access_count: number;
    title: string;
  }>;
}

export interface UserSession {
  id: string;
  device_name: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  last_active_at: string | null;
}

export function userDisplayName(user: Pick<User, 'display_name' | 'registration_status'>) {
  if (user.display_name) return user.display_name;
  if (user.registration_status === 'guest') return 'Anonymous guest';
  if (user.registration_status === 'registered') return 'Name missing';
  if (user.registration_status === 'deleted') return 'Deleted account';
  return 'Unclaimed account';
}

export function emailStatusLabel(status: User['email_status']) {
  if (status === 'none') return 'No email';
  return `${status[0].toUpperCase()}${status.slice(1)} email`;
}
