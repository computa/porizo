"use strict";

const { newUuid } = require("../../utils/ids");
const { nowIso } = require("../../utils/common");

function isTrackTransferVerified(verification, targetUserId) {
  const shareReset =
    verification.share_status === null ||
    (verification.share_creator === targetUserId &&
      verification.share_status === "unbound" &&
      verification.share_bound_device_id === null &&
      verification.share_bound_device_platform === null &&
      verification.share_bound_app_version === null &&
      verification.share_bound_user_id === null &&
      verification.share_bound_at === null);

  return (
    verification.track_owner === targetUserId &&
    verification.library_owner === targetUserId &&
    verification.library_origin === "created" &&
    verification.source_library_entries === 0 &&
    verification.active_received_entries === 0 &&
    shareReset
  );
}

function registerAdminTrackTransferRoutes(
  app,
  { adminTrackTransferRepo, requireAdminRole, sendError },
) {
  app.post(
    "/admin/dashboard/tracks/:trackId/transfer",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;

      const { trackId } = request.params;
      const { target_user_id } = request.body || {};

      if (!target_user_id) {
        sendError(reply, 400, "MISSING_TARGET", "target_user_id is required.");
        return;
      }

      const track = await adminTrackTransferRepo.findTransferTrack(trackId);
      if (!track) {
        sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
        return;
      }

      const targetUser =
        await adminTrackTransferRepo.findTransferTargetUser(target_user_id);
      if (!targetUser || targetUser.deleted_at) {
        sendError(reply, 404, "USER_NOT_FOUND", "Target user not found.");
        return;
      }

      if (track.user_id === target_user_id) {
        sendError(
          reply,
          400,
          "ALREADY_OWNED",
          "Track already belongs to this user.",
        );
        return;
      }

      const activeJob = await adminTrackTransferRepo.findActiveTrackJob(trackId);
      if (activeJob) {
        sendError(
          reply,
          409,
          "ACTIVE_JOB",
          "Track has an active render job. Wait for it to complete before transferring.",
        );
        return;
      }

      const sourceUserId = track.user_id;
      const now = nowIso();
      const transferId = newUuid();

      try {
        await adminTrackTransferRepo.transferTrackOwnership({
          trackId,
          sourceUserId,
          targetUserId: target_user_id,
          adminId: admin.adminId,
          adminEmail: admin.email,
          transferId,
          now,
        });
      } catch (err) {
        if (err.message === "ACTIVE_JOB") {
          sendError(
            reply,
            409,
            "ACTIVE_JOB",
            "Track has an active render job. Wait for it to complete before transferring.",
          );
          return;
        }
        if (err.message === "CONCURRENT_TRANSFER") {
          sendError(
            reply,
            409,
            "CONCURRENT_TRANSFER",
            "Track ownership changed during transfer. Please retry.",
          );
          return;
        }
        console.error("[Admin] Track transfer failed:", err.message);
        sendError(
          reply,
          500,
          "TRANSFER_FAILED",
          "Track transfer failed. No changes were made.",
        );
        return;
      }

      const verification = await adminTrackTransferRepo.getTransferVerification({
        trackId,
        sourceUserId,
        targetUserId: target_user_id,
      });
      if (!isTrackTransferVerified(verification, target_user_id)) {
        console.error("[Admin] Track transfer verification failed:", {
          trackId,
          sourceUserId,
          targetUserId: target_user_id,
          verification,
        });
        sendError(
          reply,
          500,
          "TRANSFER_VERIFICATION_FAILED",
          "Track transfer verification failed.",
        );
        return;
      }

      reply.send({
        transferred: true,
        track_id: trackId,
        title: track.title,
        from_user: sourceUserId,
        to_user: target_user_id,
        to_name: targetUser.display_name || null,
        verification,
      });
    },
  );
}

module.exports = { registerAdminTrackTransferRoutes };
