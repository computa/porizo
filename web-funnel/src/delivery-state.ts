export type DeliveryChannelName = "sms" | "email";

export interface DeliveryDraft {
  sender: "buyer" | "porizo";
  channels: DeliveryChannelName[];
  phone: string;
  email: string;
  senderName: string;
  note: string;
  timing: "ready" | "scheduled";
  sendAt: string;
  timezone: string;
  confirmedRevision?: number;
}

export type DeliveryDraftAction =
  | { type: "sender"; value: DeliveryDraft["sender"] }
  | { type: "toggle-channel"; value: DeliveryChannelName }
  | {
      type: "field";
      field: "phone" | "email" | "senderName" | "note" | "sendAt";
      value: string;
    }
  | { type: "timing"; value: DeliveryDraft["timing"] }
  | { type: "reset"; revision?: number }
  | { type: "saved"; revision?: number };

export function createDeliveryDraft(): DeliveryDraft {
  return {
    sender: "buyer",
    channels: [],
    phone: "",
    email: "",
    senderName: "",
    note: "",
    timing: "ready",
    sendAt: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

export function deliveryDraftReducer(
  state: DeliveryDraft,
  action: DeliveryDraftAction,
): DeliveryDraft {
  switch (action.type) {
    case "sender":
      return {
        ...state,
        sender: action.value,
        channels: action.value === "buyer" ? [] : state.channels,
      };
    case "toggle-channel":
      return {
        ...state,
        channels: state.channels.includes(action.value)
          ? state.channels.filter((channel) => channel !== action.value)
          : [...state.channels, action.value],
      };
    case "field":
      return { ...state, [action.field]: action.value };
    case "timing":
      return { ...state, timing: action.value };
    case "reset":
      return { ...createDeliveryDraft(), confirmedRevision: action.revision };
    case "saved":
      return { ...state, confirmedRevision: action.revision };
  }
}

export function deliveryRequest(draft: DeliveryDraft) {
  if (draft.sender === "buyer") {
    return {
      delivery_mode: "manual" as const,
      sender_display_name: draft.senderName.trim() || undefined,
      personal_note: draft.note.trim() || undefined,
      expires_in_days: 30,
      revision: draft.confirmedRevision,
    };
  }
  return {
    delivery_mode: draft.timing === "scheduled" ? ("scheduled" as const) : ("immediate" as const),
    channels: draft.channels,
    recipient_phone: draft.channels.includes("sms") ? draft.phone.trim() : undefined,
    recipient_email: draft.channels.includes("email") ? draft.email.trim() : undefined,
    sender_display_name: draft.senderName.trim(),
    personal_note: draft.note.trim() || undefined,
    timezone: draft.timezone,
    send_at:
      draft.timing === "scheduled"
        ? new Date(draft.sendAt).toISOString()
        : undefined,
    expires_in_days: 30,
    revision: draft.confirmedRevision,
  };
}

export function validateDeliveryDraft(draft: DeliveryDraft) {
  const errors: Partial<Record<"channels" | "phone" | "email" | "senderName" | "sendAt", string>> = {};
  if (draft.sender === "buyer") return errors;
  if (draft.channels.length === 0) errors.channels = "Choose Text, Email, or both.";
  if (draft.channels.includes("sms") && !/^\+[1-9]\d{7,14}$/.test(draft.phone.trim())) {
    errors.phone = "Enter a phone number with country code, like +61 400 000 000.";
  }
  if (
    draft.channels.includes("email") &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())
  ) {
    errors.email = "Enter a valid email address.";
  }
  if (!draft.senderName.trim()) errors.senderName = "Tell the recipient who sent the song.";
  if (draft.timing === "scheduled") {
    const timestamp = Date.parse(draft.sendAt);
    if (!Number.isFinite(timestamp) || timestamp < Date.now() + 60_000) {
      errors.sendAt = "Choose a time at least one minute from now.";
    }
  }
  return errors;
}
