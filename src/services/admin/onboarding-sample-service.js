"use strict";

const crypto = require("crypto");

function createDefaultOnboardingSampleId() {
  return `os_${crypto.randomBytes(6).toString("hex")}`;
}

function validateCreateInput({ label, audio_url }) {
  if (!label || typeof label !== "string" || label.trim().length === 0) {
    throw new Error("label is required");
  }
  if (!audio_url || typeof audio_url !== "string") {
    throw new Error("audio_url is required");
  }
  validateAudioUrl(audio_url);
  if (label.length > 200) {
    throw new Error("label must be 200 characters or fewer");
  }
  if (audio_url.length > 500) {
    throw new Error("audio_url must be 500 characters or fewer");
  }
}

function validateAudioUrl(audioUrl) {
  if (!audioUrl.startsWith("/audio/") && !audioUrl.startsWith("https://")) {
    throw new Error("audio_url must start with /audio/ or be an HTTPS URL");
  }
}

function filterUpdateFields(fields) {
  const allowedFields = ["label", "audio_url"];
  const filteredUpdates = {};

  for (const field of allowedFields) {
    if (fields[field] !== undefined) {
      filteredUpdates[field] = fields[field];
    }
  }

  if (Object.keys(filteredUpdates).length === 0) {
    throw new Error("No valid fields to update");
  }

  return filteredUpdates;
}

function validateUpdateFields(filteredUpdates) {
  if (filteredUpdates.audio_url) {
    validateAudioUrl(filteredUpdates.audio_url);
  }
  if (filteredUpdates.label && filteredUpdates.label.length > 200) {
    throw new Error("label must be 200 characters or fewer");
  }
}

function createAdminOnboardingSampleService({
  onboardingSampleRepository,
  appConfigRepository,
  audit,
  now = () => new Date().toISOString(),
  createId = createDefaultOnboardingSampleId,
}) {
  if (!onboardingSampleRepository) {
    throw new Error("onboardingSampleRepository is required");
  }
  if (!appConfigRepository) {
    throw new Error("appConfigRepository is required");
  }
  if (typeof audit !== "function") {
    throw new Error("audit function is required");
  }

  async function getOnboardingSamples() {
    return await onboardingSampleRepository.listAll();
  }

  async function getActiveOnboardingSample() {
    try {
      const row = await appConfigRepository.findActiveOnboardingSample();
      return row || null;
    } catch {
      return null;
    }
  }

  async function createOnboardingSample({ label, audio_url }, adminId) {
    validateCreateInput({ label, audio_url });

    const id = createId();
    const timestamp = now();

    await onboardingSampleRepository.createSample({
      id,
      label: label.trim(),
      audioUrl: audio_url.trim(),
      now: timestamp,
      updatedBy: adminId,
    });

    await audit(
      adminId,
      "admin_create_onboarding_sample",
      "onboarding_sample",
      id,
      { label, audio_url },
    );

    return await onboardingSampleRepository.findById(id);
  }

  async function updateOnboardingSample(id, fields, adminId) {
    const filteredUpdates = filterUpdateFields(fields);
    validateUpdateFields(filteredUpdates);

    const previous = await onboardingSampleRepository.findById(id);
    if (!previous) {
      throw new Error("Onboarding sample not found");
    }

    await onboardingSampleRepository.updateSample({
      id,
      fields: filteredUpdates,
      now: now(),
      updatedBy: adminId,
    });

    await audit(
      adminId,
      "admin_update_onboarding_sample",
      "onboarding_sample",
      id,
      {
        previous: { label: previous.label, audio_url: previous.audio_url },
        updated: filteredUpdates,
      },
    );

    return await onboardingSampleRepository.findById(id);
  }

  async function deleteOnboardingSample(id, adminId) {
    const existing = await onboardingSampleRepository.findById(id);
    if (!existing) {
      throw new Error("Onboarding sample not found");
    }

    await onboardingSampleRepository.deleteSample(id);
    await audit(
      adminId,
      "admin_delete_onboarding_sample",
      "onboarding_sample",
      id,
      { label: existing.label, audio_url: existing.audio_url },
    );

    return { success: true };
  }

  async function activateOnboardingSample(id, adminId) {
    const existing = await onboardingSampleRepository.findById(id);
    if (!existing) {
      throw new Error("Onboarding sample not found");
    }

    await onboardingSampleRepository.activateSample({
      id,
      now: now(),
      updatedBy: adminId,
    });

    await audit(
      adminId,
      "admin_activate_onboarding_sample",
      "onboarding_sample",
      id,
      { label: existing.label },
    );

    return await onboardingSampleRepository.findById(id);
  }

  return {
    getOnboardingSamples,
    getActiveOnboardingSample,
    createOnboardingSample,
    updateOnboardingSample,
    deleteOnboardingSample,
    activateOnboardingSample,
  };
}

module.exports = {
  createAdminOnboardingSampleService,
  validateCreateInput,
  validateAudioUrl,
  filterUpdateFields,
};
