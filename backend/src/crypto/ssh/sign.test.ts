import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { derEcdsaToRS, derToP1363, derToSshEcdsaSignature, encodeEcdsaSshSignature } from "./sign.js";
import { SshReader } from "./wire.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const msg = Buffer.from("detached KRL signature payload");

describe("ECDSA signature format conversions (SSH-03 / SSH-04)", () => {
  it("DER is the pinned detached format and verifies (any producer: Node here, Cosmian in the spike)", () => {
    const der = cryptoSign("sha256", msg, { key: privateKey, dsaEncoding: "der" });
    expect(der[0]).toBe(0x30); // SEQUENCE
    expect(cryptoVerify("sha256", msg, { key: publicKey, dsaEncoding: "der" }, der)).toBe(true);
  });

  it("derToP1363 yields a 64-byte r‖s that verifies as IEEE-P1363", () => {
    const der = cryptoSign("sha256", msg, { key: privateKey, dsaEncoding: "der" });
    const p1363 = derToP1363(der);
    expect(p1363.length).toBe(64);
    expect(cryptoVerify("sha256", msg, { key: publicKey, dsaEncoding: "ieee-p1363" }, p1363)).toBe(true);
  });

  it("derEcdsaToRS round-trips through P-1363 padding", () => {
    const der = cryptoSign("sha256", msg, { key: privateKey, dsaEncoding: "der" });
    const { r, s } = derEcdsaToRS(der);
    expect(r.length).toBeLessThanOrEqual(32);
    expect(s.length).toBeLessThanOrEqual(32);
    const p1363 = derToP1363(der);
    // The high-order bytes of P-1363 r equal r (right-aligned).
    expect(p1363.subarray(0, 32).subarray(32 - r.length)).toEqual(r);
  });

  it("derToSshEcdsaSignature wraps as 'ecdsa-sha2-nistp256' + string(mpint r ‖ mpint s)", () => {
    const der = cryptoSign("sha256", msg, { key: privateKey, dsaEncoding: "der" });
    const blob = derToSshEcdsaSignature(der);
    const r = new SshReader(blob);
    expect(r.cstring()).toBe("ecdsa-sha2-nistp256");
    const inner = new SshReader(r.string());
    const rr = inner.string();
    const ss = inner.string();
    expect(rr.length).toBeGreaterThan(0);
    expect(ss.length).toBeGreaterThan(0);
    expect(inner.atEnd()).toBe(true);
    expect(r.atEnd()).toBe(true);
  });

  it("encodeEcdsaSshSignature pads a high-bit value with a leading zero (mpint positivity)", () => {
    const r = Buffer.from([0x80, 0x01]); // high bit set -> needs 0x00 pad
    const s = Buffer.from([0x01]);
    const blob = encodeEcdsaSshSignature(r, s);
    const reader = new SshReader(blob);
    reader.cstring();
    const inner = new SshReader(reader.string());
    expect(inner.string()).toEqual(Buffer.from([0x00, 0x80, 0x01]));
    expect(inner.string()).toEqual(Buffer.from([0x01]));
  });
});
