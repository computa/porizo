import { useReducer, useState } from "react";
import type { OrderDelivery } from "../api/funnel";
import {
  createDeliveryDraft,
  deliveryDraftReducer,
  deliveryRequest,
  validateDeliveryDraft,
  type DeliveryChannelName,
} from "../delivery-state";

interface DeliveryChooserProps {
  recipient: string;
  delivery?: OrderDelivery;
  deliveryStatus?: string;
  contentReady: boolean;
  shareUrl?: string;
  onSave: (body: ReturnType<typeof deliveryRequest>) => Promise<void>;
  onStopChannel: (channel: DeliveryChannelName) => Promise<void>;
  automatedDeliveryEnabled?: boolean;
}

export function DeliveryChooser({
  recipient,
  delivery,
  deliveryStatus,
  contentReady,
  shareUrl,
  onSave,
  onStopChannel,
  automatedDeliveryEnabled = false,
}: DeliveryChooserProps) {
  const [draft, dispatch] = useReducer(deliveryDraftReducer, undefined, createDeliveryDraft);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<ReturnType<typeof validateDeliveryDraft>>({});
  const [saveError, setSaveError] = useState<string>();
  const [editing, setEditing] = useState(
    !delivery ||
      deliveryStatus === "not_requested" ||
      deliveryStatus === "draft",
  );

  async function save() {
    const nextErrors = validateDeliveryDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await onSave({
        ...deliveryRequest(draft),
        revision: delivery?.revision ?? draft.confirmedRevision,
      });
      setSaved(true);
      setEditing(false);
    } catch {
      setSaveError("We couldn’t save delivery. Check the details and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing && (delivery || saved)) {
    return (
      <section className="card delivery-card" aria-live="polite">
        <p className="context-label">Delivery</p>
        <h2>
          {(delivery?.mode ?? (draft.sender === "porizo" && draft.timing === "scheduled" ? "scheduled" : undefined)) === "scheduled"
            ? `Scheduled for ${delivery?.send_at ?? "the chosen time"} in ${delivery?.timezone ?? draft.timezone}`
            : (delivery?.mode ?? (draft.sender === "porizo" ? "immediate" : "manual")) === "immediate"
              ? "We’ll send it when the song is ready"
              : `You’ll send ${recipient}'s song`}
        </h2>
        {delivery?.channels?.map((channel) => (
          <div className="delivery-channel-row" key={channel.channel}>
            <span>
              {channel.channel === "sms" ? "Text" : "Email"} ·{" "}
              {channel.masked_destination ?? "destination saved"} · {humanizeChannelStatus(channel.status)}
            </span>
            {channel.can_stop && (
              <button
                className="btn-quiet"
                type="button"
                onClick={() => {
                  const label = channel.channel === "sms" ? "Text" : "Email";
                  if (
                    confirm(
                      `We’ll stop the unsent ${label}. Any delivery already accepted may still arrive. Your song and gift link stay available. No credit is returned.`,
                    )
                  ) {
                    setSaveError(undefined);
                    void onStopChannel(channel.channel).catch(() =>
                      setSaveError(
                        `We couldn’t stop the unsent ${label}. Check the status and try again.`,
                      ),
                    );
                  }
                }}
              >
                Stop {channel.channel === "sms" ? "Text" : "Email"}
              </button>
            )}
          </div>
        ))}
        {(delivery?.can_edit ?? !delivery) && (
          <button
            className="btn-quiet"
            type="button"
            onClick={() => {
              dispatch({ type: "reset", revision: delivery?.revision });
              setEditing(true);
            }}
          >
            Change delivery
          </button>
        )}
        {contentReady && shareUrl && (
          <p className="field-help">The gift link is ready even if recipient delivery needs attention.</p>
        )}
        {deliveryStatus === "failed" && (
          <p className="error-text">We couldn’t deliver it automatically. You can still send the gift link yourself.</p>
        )}
        {saveError && <p className="error-text" role="alert">{saveError}</p>}
      </section>
    );
  }

  return (
    <section className="card delivery-card">
      <h2>How should {recipient} receive it?</h2>
      <fieldset className="delivery-choice">
        <legend>Who sends it?</legend>
        <label>
          <input
            type="radio"
            name="delivery-sender"
            checked={draft.sender === "buyer"}
            onChange={() => dispatch({ type: "sender", value: "buyer" })}
          />
          I’ll send it
        </label>
        {automatedDeliveryEnabled && (
          <label>
            <input
              type="radio"
              name="delivery-sender"
              checked={draft.sender === "porizo"}
              onChange={() => dispatch({ type: "sender", value: "porizo" })}
            />
            Porizo sends it
          </label>
        )}
      </fieldset>

      {draft.sender === "porizo" && (
        <>
          <fieldset className="delivery-choice" aria-describedby={errors.channels ? "delivery-channels-error" : undefined}>
            <legend>Send by</legend>
            <ChannelToggle label="Text" channel="sms" selected={draft.channels.includes("sms")} onToggle={(value) => dispatch({ type: "toggle-channel", value })} />
            <ChannelToggle label="Email" channel="email" selected={draft.channels.includes("email")} onToggle={(value) => dispatch({ type: "toggle-channel", value })} />
            {errors.channels && <p id="delivery-channels-error" className="error-text">{errors.channels}</p>}
          </fieldset>
          {draft.channels.includes("sms") && (
            <label>
              Recipient phone
              <input className="field" type="tel" autoComplete="tel" value={draft.phone} aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? "delivery-phone-error" : undefined} onChange={(event) => dispatch({ type: "field", field: "phone", value: event.target.value })} />
              {errors.phone && <span id="delivery-phone-error" className="error-text">{errors.phone}</span>}
            </label>
          )}
          {draft.channels.includes("email") && (
            <label>
              Recipient email
              <input className="field" type="email" autoComplete="email" value={draft.email} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "delivery-email-error" : undefined} onChange={(event) => dispatch({ type: "field", field: "email", value: event.target.value })} />
              {errors.email && <span id="delivery-email-error" className="error-text">{errors.email}</span>}
            </label>
          )}
          <label>
            From
            <input className="field" value={draft.senderName} aria-invalid={Boolean(errors.senderName)} aria-describedby={errors.senderName ? "delivery-sender-error" : undefined} onChange={(event) => dispatch({ type: "field", field: "senderName", value: event.target.value })} />
            {errors.senderName && <span id="delivery-sender-error" className="error-text">{errors.senderName}</span>}
          </label>
          <fieldset className="delivery-choice">
            <legend>When?</legend>
            <label><input type="radio" name="delivery-timing" checked={draft.timing === "ready"} onChange={() => dispatch({ type: "timing", value: "ready" })} /> When it’s ready</label>
            <label><input type="radio" name="delivery-timing" checked={draft.timing === "scheduled"} onChange={() => dispatch({ type: "timing", value: "scheduled" })} /> Schedule</label>
          </fieldset>
          {draft.timing === "scheduled" && (
            <label>
              Send date and time
              <input className="field" type="datetime-local" value={draft.sendAt} aria-invalid={Boolean(errors.sendAt)} aria-describedby={errors.sendAt ? "delivery-time-error" : undefined} onChange={(event) => dispatch({ type: "field", field: "sendAt", value: event.target.value })} />
              <span className="field-help">{draft.timezone}</span>
              {errors.sendAt && <span id="delivery-time-error" className="error-text">{errors.sendAt}</span>}
            </label>
          )}
        </>
      )}
      <label>
        Note <span className="field-help">(optional)</span>
        <textarea className="field" value={draft.note} onChange={(event) => dispatch({ type: "field", field: "note", value: event.target.value })} />
      </label>
      <button className="btn-primary" type="button" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving delivery…" : draft.sender === "buyer" ? "I’ll send it" : "Confirm delivery"}
      </button>
      {saveError && <p className="error-text" role="alert">{saveError}</p>}
      <p className="field-help">You can keep this page open while we finish the song.</p>
    </section>
  );
}

function ChannelToggle({
  label,
  channel,
  selected,
  onToggle,
}: {
  label: string;
  channel: DeliveryChannelName;
  selected: boolean;
  onToggle: (channel: DeliveryChannelName) => void;
}) {
  return (
    <label>
      <input type="checkbox" checked={selected} onChange={() => onToggle(channel)} /> {label}
    </label>
  );
}

function humanizeChannelStatus(status: string) {
  switch (status) {
    case "pending":
      return "Waiting to send";
    case "accepted":
      return "Accepted by provider";
    case "delivered":
      return "Delivered";
    case "failed":
      return "Needs attention";
    case "cancelled":
      return "Stopped";
    default:
      return status.replaceAll("_", " ");
  }
}
