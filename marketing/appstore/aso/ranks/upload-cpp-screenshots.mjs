#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const API_BASE = "https://api.appstoreconnect.apple.com";
const uploadRoot =
  process.env.CPP_UPLOAD_ROOT ?? "/private/tmp/porizo-cpp-upload-2026-06-02";
const uploadExtension = process.env.CPP_UPLOAD_EXT ?? "png";

const sets = [
  {
    name: "gift iphone65",
    setId: "a3229184-6a58-47ec-bc28-152e1085727c",
    variant: "gift",
    size: "iphone65",
  },
  {
    name: "gift ipad129",
    setId: "54226421-550c-46b7-a8a9-4657a82c8521",
    variant: "gift",
    size: "ipad129",
  },
  {
    name: "anniversary iphone65",
    setId: "a814064c-fa03-4e76-9c20-347445f6f68f",
    variant: "anniversary",
    size: "iphone65",
  },
  {
    name: "anniversary ipad129",
    setId: "b164c836-f0f1-429b-8b4d-62e2ba8d4bc9",
    variant: "anniversary",
    size: "ipad129",
  },
  {
    name: "custom iphone65",
    setId: "da3d541b-5f44-4bbe-967c-f8b907e2d97f",
    variant: "custom",
    size: "iphone65",
  },
  {
    name: "custom ipad129",
    setId: "39ad30a7-1816-41cc-87a4-4bed5c7703bc",
    variant: "custom",
    size: "ipad129",
  },
];

const files = [
  `01-hero.${uploadExtension}`,
  `02-pick.${uploadExtension}`,
  `03-tell.${uploadExtension}`,
  `04-hear.${uploadExtension}`,
  `05-share.${uploadExtension}`,
];

function getToken() {
  return execFileSync("asc", ["auth", "token", "--confirm"], {
    encoding: "utf8",
  }).trim();
}

async function api(token, method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${path} failed ${res.status}: ${text}`);
  }
  return json;
}

async function listScreenshots(token, setId) {
  return api(
    token,
    "GET",
    `/v1/appScreenshotSets/${setId}/appScreenshots?limit=50&fields[appScreenshots]=fileName,fileSize,assetDeliveryState,sourceFileChecksum`,
  );
}

async function deleteExistingScreenshots(token, setId) {
  const listed = await listScreenshots(token, setId);
  for (const screenshot of listed.data ?? []) {
    await api(token, "DELETE", `/v1/appScreenshots/${screenshot.id}`);
  }
  return listed.data?.length ?? 0;
}

async function createScreenshot(token, setId, filePath, fileName) {
  const fileSize = statSync(filePath).size;
  return api(token, "POST", "/v1/appScreenshots", {
    data: {
      type: "appScreenshots",
      attributes: {
        fileName,
        fileSize,
      },
      relationships: {
        appScreenshotSet: {
          data: {
            type: "appScreenshotSets",
            id: setId,
          },
        },
      },
    },
  });
}

async function uploadBytes(operations, buffer) {
  for (const operation of operations ?? []) {
    const body = buffer.subarray(
      operation.offset,
      operation.offset + operation.length,
    );
    const headers = Object.fromEntries(
      (operation.requestHeaders ?? []).map((header) => [
        header.name,
        header.value,
      ]),
    );
    headers["Content-Length"] = String(body.length);
    const res = await fetch(operation.url, {
      method: operation.method,
      headers,
      body,
    });
    if (!res.ok) {
      throw new Error(
        `upload operation failed ${res.status}: ${await res.text()}`,
      );
    }
  }
}

async function markUploaded(token, screenshotId, checksum) {
  return api(token, "PATCH", `/v1/appScreenshots/${screenshotId}`, {
    data: {
      type: "appScreenshots",
      id: screenshotId,
      attributes: {
        sourceFileChecksum: checksum,
        uploaded: true,
      },
    },
  });
}

async function uploadSet(token, set) {
  console.log(`\n${set.name}`);
  const deleted = await deleteExistingScreenshots(token, set.setId);
  console.log(`  deleted ${deleted} existing screenshot(s)`);

  const dir = join(uploadRoot, set.variant, set.size);
  for (const fileName of files) {
    const filePath = join(dir, fileName);
    const buffer = readFileSync(filePath);
    const checksum = createHash("md5").update(buffer).digest("hex");
    const created = await createScreenshot(token, set.setId, filePath, fileName);
    const screenshotId = created.data.id;
    await uploadBytes(created.data.attributes.uploadOperations, buffer);
    await markUploaded(token, screenshotId, checksum);
    console.log(`  uploaded ${fileName}`);
  }

  const listed = await listScreenshots(token, set.setId);
  console.log(`  final count ${listed.data?.length ?? 0}`);
}

async function main() {
  const token = getToken();
  const filters = process.argv.slice(2);
  const selected = filters.length
    ? sets.filter((set) => filters.some((filter) => set.name.includes(filter)))
    : sets;
  if (selected.length === 0) {
    throw new Error(`No sets matched filters: ${filters.join(", ")}`);
  }
  for (const set of selected) {
    await uploadSet(token, set);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
