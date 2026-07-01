"use strict";

const ACCOUNT_DELETION_STORAGE_PREFIXES = Object.freeze([
  (userId) => `tracks/${userId}/`,
  (userId) => `poems/${userId}/`,
  (userId) => `enrollment/raw/${userId}/`,
  (userId) => `enrollment/clean/${userId}/`,
  (userId) => `voice_profiles/${userId}/`,
]);

function buildAccountDeletionStoragePrefixes(userId) {
  if (!userId || typeof userId !== "string") {
    throw new Error("userId is required for account deletion storage cleanup");
  }
  return ACCOUNT_DELETION_STORAGE_PREFIXES.map((buildPrefix) =>
    buildPrefix(userId),
  );
}

async function listObjectsForPrefix(storageProvider, prefix) {
  if (typeof storageProvider.listObjects === "function") {
    const keys = [];
    const prefixes = [];
    let continuationToken = null;

    do {
      const result = await storageProvider.listObjects({
        prefix,
        continuationToken,
      });
      if (Array.isArray(result?.keys)) {
        keys.push(...result.keys);
      }
      if (Array.isArray(result?.prefixes)) {
        prefixes.push(...result.prefixes);
      }
      if (result?.isTruncated && !result?.nextContinuationToken) {
        throw new Error(
          `Storage provider returned truncated account deletion listing without continuation token for ${prefix}`,
        );
      }
      continuationToken = result?.nextContinuationToken || null;
    } while (continuationToken);

    return {
      keys,
      prefixes: [...new Set(prefixes)],
    };
  }

  if (typeof storageProvider.listKeys === "function") {
    const keys = await storageProvider.listKeys({ prefix });
    return {
      keys: Array.isArray(keys) ? keys : [],
      prefixes: [],
    };
  }

  throw new Error("Storage provider cannot list account deletion artifacts");
}

async function deleteStoragePrefix(storageProvider, prefix, seenPrefixes) {
  if (seenPrefixes.has(prefix)) {
    return { deletedKeys: [], prefixesVisited: 0 };
  }
  seenPrefixes.add(prefix);

  const { keys, prefixes } = await listObjectsForPrefix(storageProvider, prefix);
  const deletedKeys = [];

  for (const key of keys) {
    await storageProvider.deleteObject({ key });
    deletedKeys.push(key);
  }

  let prefixesVisited = 1;
  for (const childPrefix of prefixes) {
    const childResult = await deleteStoragePrefix(
      storageProvider,
      childPrefix,
      seenPrefixes,
    );
    prefixesVisited += childResult.prefixesVisited;
    deletedKeys.push(...childResult.deletedKeys);
  }

  return { deletedKeys, prefixesVisited };
}

async function deleteAccountStorageArtifacts({
  storageProvider,
  userId,
  logger = console,
} = {}) {
  if (!storageProvider) {
    return {
      attempted: false,
      deletedKeys: [],
      prefixes: [],
      prefixesVisited: 0,
    };
  }
  if (typeof storageProvider.deleteObject !== "function") {
    throw new Error("Storage provider cannot delete account deletion artifacts");
  }

  const prefixes = buildAccountDeletionStoragePrefixes(userId);
  const seenPrefixes = new Set();
  const deletedKeys = [];
  let prefixesVisited = 0;

  for (const prefix of prefixes) {
    const result = await deleteStoragePrefix(storageProvider, prefix, seenPrefixes);
    prefixesVisited += result.prefixesVisited;
    deletedKeys.push(...result.deletedKeys);
  }

  logger?.info?.(
    {
      deletedKeyCount: deletedKeys.length,
      prefixesVisited,
    },
    "[AccountDeletion] Deleted storage artifacts",
  );

  return {
    attempted: true,
    deletedKeys,
    prefixes,
    prefixesVisited,
  };
}

module.exports = {
  buildAccountDeletionStoragePrefixes,
  deleteAccountStorageArtifacts,
};
