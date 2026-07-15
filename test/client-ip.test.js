require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const { getClientIp, getGuardClientIp } = require("../src/utils/client-ip");

describe("getClientIp", () => {
  test("uses a valid CF-Connecting-IP header when present", () => {
    const request = {
      headers: { "cf-connecting-ip": "203.0.113.7" },
      ip: "172.64.192.172",
    };
    assert.equal(getClientIp(request), "203.0.113.7");
  });

  test("uses a valid IPv6 CF-Connecting-IP header", () => {
    const request = {
      headers: { "cf-connecting-ip": "2001:db8::1" },
      ip: "172.64.192.172",
    };
    assert.equal(getClientIp(request), "2001:db8::1");
  });

  test("falls back to request.ip when CF header is garbage", () => {
    const request = {
      headers: { "cf-connecting-ip": "not-an-ip" },
      ip: "198.51.100.4",
    };
    assert.equal(getClientIp(request), "198.51.100.4");
  });

  test("falls back to request.ip when CF header is missing", () => {
    const request = {
      headers: {},
      ip: "198.51.100.5",
    };
    assert.equal(getClientIp(request), "198.51.100.5");
  });

  test("returns 'unknown' when neither a valid CF header nor request.ip exist", () => {
    const request = { headers: {} };
    assert.equal(getClientIp(request), "unknown");
  });

  test("returns 'unknown' when CF header is garbage and request.ip is absent", () => {
    const request = { headers: { "cf-connecting-ip": "999.999.999.999" } };
    assert.equal(getClientIp(request), "unknown");
  });

  test("tolerates a missing headers object", () => {
    const request = { ip: "198.51.100.6" };
    assert.equal(getClientIp(request), "198.51.100.6");
  });
});

describe("getGuardClientIp", () => {
  test("ignores spoofable forwarding headers unless Cloudflare ingress trust is explicit", () => {
    const previous = process.env.TRUST_CLOUDFLARE_CLIENT_IP;
    delete process.env.TRUST_CLOUDFLARE_CLIENT_IP;
    const request = {
      headers: { "cf-connecting-ip": "203.0.113.7" },
      ip: "198.51.100.20",
      raw: { socket: { remoteAddress: "192.0.2.10" } },
    };
    try {
      assert.equal(getGuardClientIp(request), "192.0.2.10");
      process.env.TRUST_CLOUDFLARE_CLIENT_IP = "true";
      assert.equal(getGuardClientIp(request), "203.0.113.7");
    } finally {
      if (previous === undefined) delete process.env.TRUST_CLOUDFLARE_CLIENT_IP;
      else process.env.TRUST_CLOUDFLARE_CLIENT_IP = previous;
    }
  });
});
