"use strict";

const net = require("net");

function maskIpAddress(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const ip = value.trim();
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }

  if (version === 6) {
    const normalized = ip.toLowerCase();
    if (normalized.includes("::")) {
      const head = normalized.split("::")[0].split(":").filter(Boolean);
      const visible = head.slice(0, 3).join(":");
      return visible ? `${visible}::/48` : "::/48";
    }
    return `${normalized.split(":").slice(0, 3).join(":")}::/48`;
  }

  return null;
}

module.exports = { maskIpAddress };
