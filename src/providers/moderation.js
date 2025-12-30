function moderationCheck({ title, recipient_name, message, lyrics }) {
  const text = [title, recipient_name, message, lyrics].filter(Boolean).join(" ");
  if (!text) {
    return { allowed: true };
  }
  const blockedPatterns = [/sound like/i, /in the style of/i, /impersonate/i];
  if (blockedPatterns.some((pattern) => pattern.test(text))) {
    return { allowed: false, reason: "IMPERSONATION_ATTEMPT" };
  }
  return { allowed: true };
}

module.exports = {
  moderationCheck,
};
