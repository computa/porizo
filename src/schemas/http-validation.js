const validationSchemas = {
  deviceRegister: {
    body: {
      type: "object",
      properties: {
        device_id: { type: "string", maxLength: 128 },
        platform: { type: "string", maxLength: 32 },
        app_version: { type: "string", maxLength: 32 },
        push_token: { type: "string", maxLength: 256 },
      },
      required: ["device_id", "platform"],
      additionalProperties: false,
    },
  },
  createTrack: {
    body: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: 200 },
        occasion: { type: "string", maxLength: 100 },
        recipient_name: { type: "string", maxLength: 100 },
        recipient_phone: { type: "string", maxLength: 32 },
        recipient_channel: { type: "string", maxLength: 32 },
        style: { type: "string", maxLength: 100 },
        duration_target: { type: "integer", minimum: 30, maximum: 180 },
        voice_mode: { type: "string", enum: ["user_voice", "ai_voice"] },
        voice_gender: { type: "string", enum: ["male", "female"] },
        message: { type: "string", maxLength: 3000 },
        relationship_type: { type: "string", maxLength: 50 },
        years_known: { type: "integer", minimum: 0, maximum: 100 },
        specific_memory: { type: "string", maxLength: 2000 },
        special_phrases: { type: "string", maxLength: 500 },
        what_makes_them_special: { type: "string", maxLength: 2000 },
        memory_answers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question_id: { type: "string", maxLength: 20 },
              question: { type: "string", maxLength: 500 },
              answer: { type: "string", maxLength: 1000 },
            },
            required: ["question_id", "question", "answer"],
          },
          maxItems: 5,
        },
      },
      additionalProperties: false,
    },
  },
  createVersion: {
    body: {
      type: "object",
      properties: {
        render_type: { type: "string", enum: ["preview", "full"] },
        parent_version_id: { type: "string", format: "uuid" },
        params: { type: "object" },
      },
      additionalProperties: false,
    },
  },
  enrollmentStart: {
    body: {
      type: "object",
      required: ["consent_accepted"],
      properties: {
        consent_accepted: { type: "boolean", const: true },
        consent_version: { type: "string", maxLength: 50 },
        consent_scopes: {
          type: "array",
          items: { type: "string", maxLength: 100 },
          maxItems: 16,
        },
        voice_suno_persona_consent: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  enrollmentComplete: {
    body: {
      type: "object",
      required: ["session_id"],
      properties: {
        session_id: { type: "string", format: "uuid" },
        consent_scopes: {
          type: "array",
          items: { type: "string", maxLength: 100 },
          maxItems: 16,
        },
        voice_suno_persona_consent: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  shareClaim: {
    body: {
      type: "object",
      properties: {
        device_id: { type: "string", minLength: 1, maxLength: 255 },
        platform: { type: "string", enum: ["ios", "android", "web"] },
        app_version: { type: "string", maxLength: 20 },
        pin: { type: "string", pattern: "^[0-9]{6}$" },
        receiver_session_id: { type: "string", pattern: "^rs_[a-f0-9]{24}$" },
        receiver_session_secret: {
          type: "string",
          pattern: "^[a-f0-9]{48}$",
        },
      },
      additionalProperties: false,
    },
  },
  generateLyrics: {
    body: {
      type: "object",
      properties: {
        custom_prompt: { type: "string", maxLength: 500 },
      },
      additionalProperties: false,
    },
  },
  memoryQuestions: {
    body: {
      type: "object",
      required: ["memory"],
      properties: {
        memory: { type: "string", minLength: 5, maxLength: 500 },
        occasion: { type: "string", maxLength: 100 },
        recipient_name: { type: "string", maxLength: 100 },
      },
      additionalProperties: false,
    },
  },
};

module.exports = {
  validationSchemas,
};
