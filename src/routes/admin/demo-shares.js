"use strict";

const DEMO_EXPIRES_AT = "2125-01-01T00:00:00.000Z";

function buildDemoShareUrl(appConfig, shareId, resourceType) {
  const publicBase =
    appConfig.PUBLIC_BASE_URL ||
    appConfig.STREAM_BASE_URL ||
    "https://porizo.co";
  if (resourceType === "poem") {
    return `${publicBase}/poem/${shareId}?web=1`;
  }
  return `${publicBase}/play/${shareId}?web=1`;
}

function registerAdminDemoShareRoutes(
  app,
  {
    adminDemoShareRepo,
    appConfig,
    auditService,
    newUuid,
    nowIso,
    requireAdminRole,
    requireAdminSession,
    sendError,
  },
) {
  app.post("/admin/dashboard/demo-shares", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["admin", "superadmin"]);
    if (!admin) return;

    const { resource_type, resource_id } = request.body || {};
    if (!resource_type || !["song", "poem"].includes(resource_type)) {
      return sendError(
        reply,
        400,
        "INVALID_PARAMS",
        "resource_type must be 'song' or 'poem'",
      );
    }
    if (!resource_id) {
      return sendError(reply, 400, "INVALID_PARAMS", "resource_id is required");
    }

    if (resource_type === "song") {
      const track = await adminDemoShareRepo.getShareableTrack(resource_id);
      if (!track) {
        return sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found");
      }

      const existing =
        await adminDemoShareRepo.getSongDemoShareByTrack(resource_id);

      let shareId;
      if (existing) {
        shareId = existing.id;
        await adminDemoShareRepo.convertSongShareToDemo({
          shareId,
          expiresAt: DEMO_EXPIRES_AT,
        });
      } else {
        shareId = newUuid();
        const trackVersion =
          await adminDemoShareRepo.getLatestTrackVersion(resource_id);
        if (!trackVersion) {
          return sendError(
            reply,
            400,
            "NO_VERSION",
            "Track has no rendered version",
          );
        }
        await adminDemoShareRepo.createSongDemoShare({
          shareId,
          trackId: resource_id,
          trackVersionId: trackVersion.id,
          creatorId: track.user_id,
          expiresAt: DEMO_EXPIRES_AT,
          now: nowIso(),
        });
        await adminDemoShareRepo.linkTrackShareToken({
          shareId,
          trackId: resource_id,
        });
      }

      await auditService.audit(
        admin.adminId,
        "admin_create_demo_share",
        "share_token",
        shareId,
        {
          resource_type: "song",
          resource_id,
          action: existing ? "converted_existing" : "created_new",
        },
      );

      reply.send({
        success: true,
        share_id: shareId,
        share_url: buildDemoShareUrl(appConfig, shareId, "song"),
        resource_type: "song",
        resource_id,
      });
    } else {
      const poem = await adminDemoShareRepo.getShareablePoem(resource_id);
      if (!poem) {
        return sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found");
      }

      const existing =
        await adminDemoShareRepo.getPoemDemoShareByPoem(resource_id);

      let shareId;
      if (existing) {
        shareId = existing.id;
        await adminDemoShareRepo.convertPoemShareToDemo({
          shareId,
          expiresAt: DEMO_EXPIRES_AT,
        });
      } else {
        shareId = newUuid();
        await adminDemoShareRepo.createPoemDemoShare({
          shareId,
          poemId: resource_id,
          creatorId: poem.user_id,
          expiresAt: DEMO_EXPIRES_AT,
          now: nowIso(),
        });
      }

      await auditService.audit(
        admin.adminId,
        "admin_create_demo_share",
        "poem_share_token",
        shareId,
        {
          resource_type: "poem",
          resource_id,
          action: existing ? "converted_existing" : "created_new",
        },
      );

      reply.send({
        success: true,
        share_id: shareId,
        share_url: buildDemoShareUrl(appConfig, shareId, "poem"),
        resource_type: "poem",
        resource_id,
      });
    }
  });

  app.get("/admin/dashboard/demo-shares", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const songShares = await adminDemoShareRepo.listSongDemoShares();
    const poemShares = await adminDemoShareRepo.listPoemDemoShares();

    const allShares = [...songShares, ...poemShares].map((share) => ({
      ...share,
      share_url: buildDemoShareUrl(appConfig, share.id, share.resource_type),
    }));

    reply.send({ demo_shares: allShares });
  });

  app.post("/admin/dashboard/demo-share/:id/revoke", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["admin", "superadmin"]);
    if (!admin) return;

    const shareId = request.params.id;

    let share = await adminDemoShareRepo.getSongDemoShareById(shareId);
    if (share) {
      await adminDemoShareRepo.revokeSongDemoShare(shareId);
      await auditService.audit(
        admin.adminId,
        "admin_revoke_demo_share",
        "share_token",
        shareId,
        {
          resource_type: "song",
          track_id: share.track_id,
        },
      );
      return reply.send({ success: true, revoked: true });
    }

    share = await adminDemoShareRepo.getPoemDemoShareById(shareId);
    if (share) {
      await adminDemoShareRepo.revokePoemDemoShare(shareId);
      await auditService.audit(
        admin.adminId,
        "admin_revoke_demo_share",
        "poem_share_token",
        shareId,
        {
          resource_type: "poem",
          poem_id: share.poem_id,
        },
      );
      return reply.send({ success: true, revoked: true });
    }

    sendError(reply, 404, "DEMO_SHARE_NOT_FOUND", "Demo share not found");
  });
}

module.exports = { registerAdminDemoShareRoutes };
