#!/usr/bin/env node
"use strict";

require("dotenv/config");

const { getDatabase } = require("../src/database");
const {
  createEtsyKeyRotationService,
} = require("../src/services/etsy-key-rotation-service");

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await getDatabase();
  try {
    const service = createEtsyKeyRotationService(db);
    const before = await service.scan();
    const after = apply ? await service.rotate() : before;
    process.stdout.write(
      `${JSON.stringify({ mode: apply ? "apply" : "scan", before, after }, null, 2)}\n`,
    );
    if (apply && after.old_envelope_count !== 0) process.exitCode = 2;
  } finally {
    await db.close?.();
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
