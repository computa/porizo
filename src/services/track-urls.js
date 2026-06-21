const { trackPreviewKey, trackMasterKey } = require("../storage");

function buildTrackVersionUrls({
  storageProvider,
  track,
  version,
  baseUrl,
  rewriteStreamUrl,
}) {
  const rewrite =
    typeof rewriteStreamUrl === "function" ? rewriteStreamUrl : (url) => url;
  let previewUrl = rewrite(version.preview_url, baseUrl);
  let fullUrl = rewrite(version.full_url, baseUrl);

  if (storageProvider?.type === "s3" && track?.user_id) {
    if (version.preview_url) {
      const previewKey = trackPreviewKey({
        userId: track.user_id,
        trackId: track.id,
        versionNum: version.version_num,
      });
      previewUrl = storageProvider.createPresignedDownload({
        key: previewKey,
        expiresInSec: 3600,
      }).url;
    }
    if (version.full_url) {
      // OWNER-ONLY: this presigned URL points at the full master. Both callers
      // (GET /tracks/:id, GET /tracks/:id/versions) are requireUserId +
      // ownership-gated. Never expose buildTrackVersionUrls on a share/recipient
      // path — it would bypass the app-only share gating entirely.
      const fullKey = trackMasterKey({
        userId: track.user_id,
        trackId: track.id,
        versionNum: version.version_num,
        format: "m4a",
      });
      fullUrl = storageProvider.createPresignedDownload({
        key: fullKey,
        expiresInSec: 3600,
      }).url;
    }
  }

  return { previewUrl, fullUrl };
}

module.exports = {
  buildTrackVersionUrls,
};
