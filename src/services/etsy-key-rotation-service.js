"use strict";

const {
  currentKeyId,
  decryptValue,
  encryptValue,
  lookupHash,
} = require("./etsy-secrets");

function envelopeKid(value) {
  if (!value) return null;
  const envelope = typeof value === "string" ? JSON.parse(value) : value;
  return envelope?.kid || null;
}

function createEtsyKeyRotationService(db) {
  async function encryptedRows() {
    const connections = await db
      .prepare(
        `SELECT shop_id, access_token_encrypted, refresh_token_encrypted
           FROM etsy_connections
          WHERE access_token_encrypted IS NOT NULL
             OR refresh_token_encrypted IS NOT NULL`,
      )
      .all();
    const orders = await db
      .prepare(
        `SELECT id, buyer_email_encrypted
           FROM etsy_orders WHERE buyer_email_encrypted IS NOT NULL`,
      )
      .all();
    return { connections, orders };
  }

  async function scan() {
    const counts = {};
    const add = (value) => {
      const kid = envelopeKid(value);
      if (kid) counts[kid] = (counts[kid] || 0) + 1;
    };
    const { connections, orders } = await encryptedRows();
    for (const row of connections) {
      add(row.access_token_encrypted);
      add(row.refresh_token_encrypted);
    }
    for (const row of orders) add(row.buyer_email_encrypted);
    return {
      current_key_id: currentKeyId(),
      envelope_counts: counts,
      old_envelope_count: Object.entries(counts)
        .filter(([kid]) => kid !== currentKeyId())
        .reduce((total, [, count]) => total + count, 0),
    };
  }

  async function rotate() {
    const current = currentKeyId();
    await db.transaction(async (query) => {
      const connectionResult = await query(
        `SELECT shop_id, access_token_encrypted, refresh_token_encrypted
           FROM etsy_connections
          WHERE access_token_encrypted IS NOT NULL
             OR refresh_token_encrypted IS NOT NULL`,
      );
      for (const row of connectionResult.rows || connectionResult) {
        const access =
          envelopeKid(row.access_token_encrypted) === current
            ? row.access_token_encrypted
            : encryptValue(decryptValue(row.access_token_encrypted));
        const refresh =
          envelopeKid(row.refresh_token_encrypted) === current
            ? row.refresh_token_encrypted
            : encryptValue(decryptValue(row.refresh_token_encrypted));
        await query(
          `UPDATE etsy_connections
              SET access_token_encrypted = ?, refresh_token_encrypted = ?,
                  updated_at = CURRENT_TIMESTAMP
            WHERE shop_id = ?`,
          [access, refresh, row.shop_id],
        );
      }

      const orderResult = await query(
        `SELECT id, buyer_email_encrypted
           FROM etsy_orders WHERE buyer_email_encrypted IS NOT NULL`,
      );
      for (const row of orderResult.rows || orderResult) {
        if (envelopeKid(row.buyer_email_encrypted) === current) continue;
        const email = decryptValue(row.buyer_email_encrypted);
        await query(
          `UPDATE etsy_orders
              SET buyer_email_encrypted = ?,
                  buyer_email_lookup_hash = ?,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
          [encryptValue(email), lookupHash(email), row.id],
        );
      }
    });
    return scan();
  }

  return { scan, rotate };
}

module.exports = {
  createEtsyKeyRotationService,
  envelopeKid,
};
