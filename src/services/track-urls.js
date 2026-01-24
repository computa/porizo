const { trackPreviewKey, trackMasterKey } = require("../storage");

function buildTrackVersionUrls({ storageProvider, track, version, baseUrl, rewriteStreamUrl }) {
  const rewrite = typeof rewriteStreamUrl === "function" ? rewriteStreamUrl : (url) => url;
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
