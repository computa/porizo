export interface GiftOverview {
  scheduled_count: number;
  due_soon_count: number;
  overdue_count: number;
  dispatching_count: number;
  retrying_count: number;
  partial_count: number;
  failed_count: number;
  cancelled_count: number;
  dispatched_count: number;
  sent_last_24h: number;
  open_incidents: number;
  acknowledged_incidents: number;
}

export interface GiftOrderSummary {
  id: string;
  sender_user_id: string;
  sender_display_name: string | null;
  sender_email: string | null;
  content_type: 'song' | 'poem';
  content_id: string;
  content_title: string | null;
  status: string;
  dispatch_status: string;
  delivery_mode: string;
  send_at: string;
  sender_timezone: string;
  channels: string[];
  recipient_phone: string | null;
  recipient_email: string | null;
  share_token_id: string | null;
  share_url: string | null;
  share_url_masked: string | null;
  claim_policy: string;
  expires_in_days: number;
  dispatch_attempts: number;
  last_dispatch_error: string | null;
  dispatched_at: string | null;
  cancelled_at: string | null;
  first_dispatch_started_at: string | null;
  last_dispatch_completed_at: string | null;
  last_successful_delivery_at: string | null;
  delivery_lag_ms: number | null;
  overdue_detected_at: string | null;
  created_at: string;
  updated_at: string;
  outbox_count: number;
  sent_count: number;
  failed_count: number;
  open_incident_count: number;
  can_retry: boolean;
  can_cancel: boolean;
}

export interface GiftOutboxRow {
  id: string;
  gift_order_id: string;
  channel: string;
  provider_name: string | null;
  recipient: string | null;
  status: string;
  attempt_count: number;
  provider_message_id: string | null;
  last_error: string | null;
  send_after: string;
  next_retry_at: string | null;
  last_attempt_at: string | null;
  locked_at: string | null;
  first_queued_at: string | null;
  first_attempt_started_at: string | null;
  provider_accepted_at: string | null;
  receipt_status: string | null;
  receipt_event_at: string | null;
  receipt_updated_at: string | null;
  updated_at: string;
}

export interface GiftIncident {
  id: string;
  incident_key: string;
  incident_type: string;
  severity: string;
  status: string;
  gift_order_id: string | null;
  outbox_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  summary: string;
  detail: string | null;
  created_at: string;
  updated_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  metadata: Record<string, unknown>;
}

export interface GiftAuditLog {
  id: string;
  user_id: string | null;
  action: string;
  created_at: string;
  metadata: Record<string, unknown>;
  note: string | null;
}

export interface GiftOrderDetailResponse {
  gift: GiftOrderSummary;
  outbox: GiftOutboxRow[];
  incidents: GiftIncident[];
  audit_logs: GiftAuditLog[];
}
