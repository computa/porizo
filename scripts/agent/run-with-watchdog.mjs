#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

function usage() {
  console.log(`Usage: node scripts/agent/run-with-watchdog.mjs [options] -- <command> [args...]

Options:
  --estimate-minutes <n>  Expected duration (default: 10)
  --silent-seconds <n>    Warn after no output (default: 300)
  --hard-seconds <n>      Terminate deadline (default: twice estimate)
  --status-seconds <n>    Heartbeat interval (default: 60)
  --help                  Show this help`);
}

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be positive`);
  return number;
}

export function parseArguments(argv) {
  const separator = argv.indexOf("--");
  const options = separator === -1 ? argv : argv.slice(0, separator);
  const command = separator === -1 ? [] : argv.slice(separator + 1);
  const parsed = {
    estimateMinutes: 10,
    silentSeconds: 300,
    hardSeconds: undefined,
    statusSeconds: 60,
    command,
  };

  for (let index = 0; index < options.length; index += 1) {
    const argument = options[index];
    if (argument === "--help") return { help: true };
    const value = options[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    if (argument === "--estimate-minutes") parsed.estimateMinutes = positiveNumber(value, argument);
    else if (argument === "--silent-seconds") parsed.silentSeconds = positiveNumber(value, argument);
    else if (argument === "--hard-seconds") parsed.hardSeconds = positiveNumber(value, argument);
    else if (argument === "--status-seconds") parsed.statusSeconds = positiveNumber(value, argument);
    else throw new Error(`Unknown argument: ${argument}`);
    index += 1;
  }
  parsed.hardSeconds ??= parsed.estimateMinutes * 120;
  if (parsed.command.length === 0) throw new Error("A command is required after --");
  return parsed;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    usage();
    return 0;
  }

  const startedAt = Date.now();
  let lastOutputAt = startedAt;
  let terminated = false;
  const [command, ...args] = options.command;
  console.error(`[watchdog] starting: ${options.command.join(" ")}`);
  console.error(`[watchdog] estimate=${options.estimateMinutes}m silent-warning=${options.silentSeconds}s hard-limit=${options.hardSeconds}s`);

  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });
  const observedOutput = (stream, target) => {
    stream.on("data", (chunk) => {
      lastOutputAt = Date.now();
      target.write(chunk);
    });
  };
  observedOutput(child.stdout, process.stdout);
  observedOutput(child.stderr, process.stderr);

  const heartbeat = setInterval(() => {
    const now = Date.now();
    const elapsedSeconds = Math.round((now - startedAt) / 1000);
    const silentForSeconds = Math.round((now - lastOutputAt) / 1000);
    const warning = silentForSeconds >= options.silentSeconds ? " INVESTIGATE_NO_OUTPUT" : "";
    console.error(`[watchdog] elapsed=${elapsedSeconds}s silent=${silentForSeconds}s${warning}`);
  }, options.statusSeconds * 1000);

  const hardTimeout = setTimeout(() => {
    terminated = true;
    console.error(`[watchdog] hard limit reached after ${options.hardSeconds}s; terminating child`);
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
  }, options.hardSeconds * 1000);

  const forwardSignal = (signal) => child.kill(signal);
  process.once("SIGINT", forwardSignal);
  process.once("SIGTERM", forwardSignal);

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (terminated) resolve(124);
      else if (signal) resolve(128);
      else resolve(code ?? 1);
    });
  });

  clearInterval(heartbeat);
  clearTimeout(hardTimeout);
  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
  console.error(`[watchdog] finished exit=${exitCode} elapsed=${elapsedSeconds}s`);
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      console.error(`watchdog failed: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
