"use strict";

const {
  createContactDeliveryRepository,
} = require("../database/contact-delivery-repository");
const { newUuid } = require("../utils/ids");

const EVENT_STATUS = Object.freeze({
  "email.delivered": "deliverable",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.suppressed": "suppressed",
});
const TERMINAL_STATUSES = new Set(["bounced", "complained", "suppressed"]);

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeEventAt(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("INVALID_DELIVERY_EVENT_AT");
  return parsed.toISOString();
}

function presentContact(row) {
  if (!row) return null;
  return {
    contactId: row.id,
    userId: row.user_id,
    email: row.value_normalized,
    isRelay: Boolean(row.is_relay),
    isVerified: Boolean(row.verified_at),
    deliveryStatus: row.delivery_status,
    isSuppressed: TERMINAL_STATUSES.has(row.delivery_status),
    lastDeliveryEventAt: row.last_delivery_event_at,
    deliveredAt: row.delivered_at,
    bouncedAt: row.bounced_at,
    complainedAt: row.complained_at,
    suppressedAt: row.suppressed_at,
    suppressionReason: row.suppression_reason,
  };
}

function createContactDeliveryService(db, options = {}) {
  const repository = options.repository || createContactDeliveryRepository(db);
  const now = options.now || (() => new Date().toISOString());
  const createId = options.createId || newUuid;

  async function getEmailDeliveryState({ contactId = null, userId = null, email = null }) {
    if (!contactId && !email) throw new Error("CONTACT_LOOKUP_REQUIRED");
    if (!contactId && !userId) {
      const rows = await repository.findEmailContactsByAddress(normalizeEmail(email));
      const states = rows.map(presentContact);
      return states.find((state) => state.isSuppressed) || states[0] || null;
    }
    const row = await repository.findEmailContact({
      contactId,
      userId,
      valueNormalized: email ? normalizeEmail(email) : null,
    });
    return presentContact(row);
  }

  async function canSendLifecycleEmail(args) {
    const state = await getEmailDeliveryState(args);
    return {
      allowed: Boolean(state) && !state.isSuppressed,
      reason: !state ? "contact_not_found" : state.isSuppressed ? "contact_suppressed" : null,
      contact: state,
    };
  }

  async function recordDeliveryEvent({
    provider,
    eventId,
    eventType,
    recipient = null,
    contactId = null,
    eventAt,
    reason = null,
  }) {
    const normalizedProvider = String(provider || "").trim().toLowerCase();
    const normalizedEventId = String(eventId || "").trim();
    const normalizedEventType = String(eventType || "").trim().toLowerCase();
    const deliveryStatus = EVENT_STATUS[normalizedEventType];
    if (!normalizedProvider || !normalizedEventId) throw new Error("DELIVERY_EVENT_ID_REQUIRED");
    if (!deliveryStatus) throw new Error("UNSUPPORTED_DELIVERY_EVENT");
    if (!contactId && !normalizeEmail(recipient)) throw new Error("DELIVERY_RECIPIENT_REQUIRED");

    const normalizedEventAt = normalizeEventAt(eventAt);
    return repository.transaction(async (tx) => {
      const contacts = contactId
        ? [await tx.findEmailContact({ contactId })].filter(Boolean)
        : await tx.findEmailContactsByAddress(normalizeEmail(recipient));
      let updatedContacts = 0;
      let insertedEvents = 0;

      for (const contact of contacts) {
        const inserted = await tx.insertEvent({
          id: createId(),
          contactId: contact.id,
          provider: normalizedProvider,
          providerEventId: normalizedEventId,
          eventType: normalizedEventType,
          deliveryStatus,
          eventAt: normalizedEventAt,
          createdAt: now(),
        });
        if (!inserted.changes) continue;
        insertedEvents += 1;
        const updated = await tx.applyEvent({
          contactId: contact.id,
          deliveryStatus,
          eventAt: normalizedEventAt,
          reason,
        });
        updatedContacts += updated.changes;
      }

      return {
        matchedContacts: contacts.length,
        updatedContacts,
        duplicate: contacts.length > 0 && insertedEvents === 0,
        deliveryStatus,
      };
    });
  }

  return { getEmailDeliveryState, canSendLifecycleEmail, recordDeliveryEvent };
}

module.exports = {
  EVENT_STATUS,
  TERMINAL_STATUSES,
  createContactDeliveryService,
};
