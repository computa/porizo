"use strict";

function registerAdminProviderConfigRoutes(
  app,
  { appConfig, adminService, requireAdminRole, requireAdminSession, sendError },
) {
  app.get("/admin/dashboard/stt/config", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const config = await adminService.getSTTConfig();
    reply.send(config);
  });

  app.put("/admin/dashboard/stt/config", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const { primary_provider, fallback_provider, whisperkit_model } =
      request.body || {};

    try {
      const result = await adminService.setSTTConfig(
        { primary_provider, fallback_provider, whisperkit_model },
        admin.adminId,
      );
      reply.send(result);
    } catch (err) {
      sendError(reply, 400, "INVALID_CONFIG", err.message);
    }
  });

  app.get("/admin/dashboard/music/config", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    try {
      const config = await adminService.getMusicProviderConfig();
      reply.send({
        ...config,
        available_providers: {
          elevenlabs: Boolean(appConfig.ELEVENLABS_API_KEY),
          suno: Boolean(appConfig.SUNO_API_KEY),
        },
        available_suno_models: ["V4_5", "V5", "V5_5"],
        available_generation_modes: ["composition_plan", "compose_detailed"],
      });
    } catch (err) {
      sendError(
        reply,
        500,
        "MUSIC_CONFIG_ERROR",
        "Failed to load music provider config.",
      );
    }
  });

  app.put("/admin/dashboard/music/config", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const {
      default_provider,
      suno_model,
      auto_style_routing,
      elevenlabs_generation_mode,
      auto_reroll_enabled,
      quality_threshold,
      max_rerolls,
      style_overrides,
    } = request.body || {};

    if (
      !request.body ||
      typeof request.body !== "object" ||
      Object.keys(request.body).length === 0
    ) {
      return sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "Request body must contain at least one config key.",
      );
    }

    if (default_provider !== undefined) {
      if (default_provider !== "suno") {
        return sendError(
          reply,
          400,
          "INVALID_CONFIG",
          "default_provider must be suno; ElevenLabs no longer handles song generation.",
        );
      }
    }

    try {
      const result = await adminService.setMusicProviderConfig(
        {
          ...(default_provider !== undefined ? { default_provider } : {}),
          ...(suno_model !== undefined ? { suno_model } : {}),
          ...(auto_style_routing !== undefined ? { auto_style_routing } : {}),
          ...(elevenlabs_generation_mode !== undefined
            ? { elevenlabs_generation_mode }
            : {}),
          ...(auto_reroll_enabled !== undefined ? { auto_reroll_enabled } : {}),
          ...(quality_threshold !== undefined ? { quality_threshold } : {}),
          ...(max_rerolls !== undefined ? { max_rerolls } : {}),
          ...(style_overrides !== undefined ? { style_overrides } : {}),
        },
        admin.adminId,
      );
      reply.send(result);
    } catch (err) {
      sendError(reply, 400, "INVALID_CONFIG", err.message);
    }
  });
}

module.exports = { registerAdminProviderConfigRoutes };
