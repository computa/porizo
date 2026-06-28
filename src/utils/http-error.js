"use strict";

function sendError(reply, statusCode, error, message, details) {
  const payload = { error, message };
  if (details && typeof details === "object") {
    Object.assign(payload, details);
  }
  return reply.code(statusCode).send(payload);
}

module.exports = {
  sendError,
};
