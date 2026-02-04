/**
 * Shared Pino Logger
 *
 * Provides structured JSON logging that Railway's log aggregation properly indexes.
 * Child loggers are created for each subsystem to enable filtering by subsystem.
 */

const pino = require("pino");

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  // In production, output raw JSON for Railway's log aggregation
  // In development, use pino-pretty for human-readable output
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

// Create child loggers for specific subsystems
// These add a "subsystem" field to all log entries for filtering
const authLogger = logger.child({ subsystem: "auth" });
const billingLogger = logger.child({ subsystem: "billing" });
const enrollmentLogger = logger.child({ subsystem: "enrollment" });
const smsLogger = logger.child({ subsystem: "sms" });

module.exports = {
  logger,
  authLogger,
  billingLogger,
  enrollmentLogger,
  smsLogger,
};
