const { getCanonicalNarrative } = require("./semantic-story-package");

function buildReadyConfirmation(state, gapAnalysis) {
  const recipient = state?.recipient_name || "them";
  const narrative = getCanonicalNarrative(state);
  if (narrative) {
    return `I’ve integrated your story into one coherent narrative for ${recipient}. It feels complete and ready. Should I lock this in for lyrics?`;
  }

  const covered = (gapAnalysis?.slots || []).filter((slot) => slot.status === "covered").length;
  return `I have enough detail to move forward for ${recipient} (${covered} core story elements covered). Should I lock this in for lyrics?`;
}

module.exports = {
  buildReadyConfirmation,
};
