#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const origin = new URL(
  process.env.MAGIC_LOGIN_WEB_ORIGIN || "https://auth.porizo.co",
);
const appIdentifier =
  process.env.IOS_APP_IDENTIFIER || "5VCH6937XM.porizo.ios.app.PorizoApp";
const androidPackage = process.env.ANDROID_PACKAGE || "com.porizo.app";
const expectedFingerprint = normalizeFingerprint(
  process.env.ANDROID_PLAY_SIGNING_SHA256 || "",
);
const root = process.cwd();
const androidManifestPath = process.env.ANDROID_MANIFEST_PATH;

function normalizeFingerprint(value) {
  return String(value).trim().toUpperCase().replace(/[^A-F0-9]/g, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readText(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  assert(response.ok, `${label} returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  assert(
    contentType.toLowerCase().includes("application/json"),
    `${label} must return application/json (received ${contentType || "none"})`,
  );
  return response.json();
}

function verifyAasa(document, label) {
  const details = document?.applinks?.details;
  assert(Array.isArray(details), `${label} has no applinks.details array`);
  const entry = details.find((candidate) => candidate.appID === appIdentifier);
  assert(entry, `${label} does not contain ${appIdentifier}`);
  const paths = Array.isArray(entry.paths) ? entry.paths : [];
  const components = Array.isArray(entry.components) ? entry.components : [];
  assert(
    paths.some((value) => String(value).startsWith("/auth/magic/ios")) ||
      components.some((value) =>
        String(value?.["/"] || "").startsWith("/auth/magic/ios"),
      ),
    `${label} does not allow /auth/magic/ios`,
  );
}

function verifyAssetLinks(document) {
  assert(Array.isArray(document), "assetlinks.json must be an array");
  const entry = document.find(
    (candidate) => candidate?.target?.package_name === androidPackage,
  );
  assert(entry, `assetlinks.json does not contain ${androidPackage}`);
  assert(
    expectedFingerprint.length === 64,
    "ANDROID_PLAY_SIGNING_SHA256 must contain the 32-byte Play App Signing SHA-256 fingerprint",
  );
  const fingerprints =
    entry.target?.sha256_cert_fingerprints?.map(normalizeFingerprint) || [];
  assert(
    fingerprints.includes(expectedFingerprint),
    "assetlinks.json does not contain ANDROID_PLAY_SIGNING_SHA256",
  );
}

async function main() {
  assert(origin.protocol === "https:", "MAGIC_LOGIN_WEB_ORIGIN must use https");
  assert(
    androidManifestPath,
    "ANDROID_MANIFEST_PATH must point to the release AndroidManifest.xml",
  );

  const [entitlements, manifest, originAasa, cdnAasa, assetLinks] =
    await Promise.all([
      readText("PorizoApp/PorizoApp/PorizoApp.entitlements"),
      fs.readFile(path.resolve(root, androidManifestPath), "utf8"),
      fetchJson(
        new URL("/.well-known/apple-app-site-association", origin),
        "origin AASA",
      ),
      fetchJson(
        `https://app-site-association.cdn-apple.com/a/v1/${origin.hostname}`,
        "Apple CDN AASA",
      ),
      fetchJson(new URL("/.well-known/assetlinks.json", origin), "assetlinks.json"),
    ]);

  assert(
    entitlements.includes(`applinks:${origin.hostname}`),
    `iOS entitlements do not contain applinks:${origin.hostname}`,
  );
  assert(
    manifest.includes(`android:host="${origin.hostname}"`) &&
      manifest.includes('android:path="/auth/magic/android"'),
    "Android manifest does not declare the magic-login App Link",
  );
  verifyAasa(originAasa, "origin AASA");
  verifyAasa(cdnAasa, "Apple CDN AASA");
  verifyAssetLinks(assetLinks);

  console.log(`Magic-login association preflight passed for ${origin.origin}`);
}

main().catch((error) => {
  console.error(`Magic-login association preflight failed: ${error.message}`);
  process.exitCode = 1;
});
