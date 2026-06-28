"use strict";

function createUserEmailPreferencesRepository(db) {
  async function markLifecycleEmailsUnsubscribed({ userId, unsubscribedAt }) {
    return db
      .prepare(
        "UPDATE users SET unsubscribed_at = COALESCE(unsubscribed_at, ?) WHERE id = ?",
      )
      .run(unsubscribedAt, userId);
  }

  return {
    markLifecycleEmailsUnsubscribed,
  };
}

module.exports = {
  createUserEmailPreferencesRepository,
};
