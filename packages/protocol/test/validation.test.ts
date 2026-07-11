import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeTextFrame, parseCommandBody, ProtocolError, validateCanonicalBase64, validateImageData } from "../src/index.ts";

test("text framing rejects binary, scalar, trailing JSON, invalid UTF-8, and ordinary oversize", () => {
  assert.throws(() => decodeTextFrame(Buffer.from("{}"), true), ProtocolError);
  assert.throws(() => decodeTextFrame(Buffer.from("1"), false), ProtocolError);
  assert.throws(() => decodeTextFrame(Buffer.from("{} {}"), false), ProtocolError);
  assert.throws(() => decodeTextFrame(Buffer.from([0xc3, 0x28]), false), ProtocolError);
  assert.throws(() => decodeTextFrame(Buffer.from(JSON.stringify({ type: "hello", value: "x".repeat(256 * 1024) })), false), (e: any) => e.code === "message_too_large");
});

test("attachment base64 is canonical and image signatures cannot be spoofed", () => {
  assert.throws(() => validateCanonicalBase64("AB=="));
  assert.throws(() => validateImageData("image/png", Buffer.from("%PDF").toString("base64")));
  assert.equal(validateImageData("image/png", Buffer.from([137,80,78,71,13,10,26,10]).toString("base64")).length, 8);
});

test("native v3 prompt parsing enforces decoded attachment limits and signatures", () => {
  assert.throws(() => parseCommandBody({ type: "prompt", text: "inspect", images: [{ name: "fake.png", mimeType: "image/png", data: Buffer.from("%PDF").toString("base64") }] }), (e: any) => e.code === "invalid_image_signature");
  const oversizedCanonical = Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64");
  assert.throws(() => parseCommandBody({ type: "prompt", text: "inspect", files: [{ name: "large.pdf", mimeType: "application/pdf", encoding: "base64", data: oversizedCanonical }] }), (e: any) => e.code === "attachment_too_large");
  const png = { name: "pixel.png", mimeType: "image/png", data: Buffer.from([137,80,78,71,13,10,26,10]).toString("base64") };
  assert.throws(() => parseCommandBody({ type: "prompt", text: "inspect", images: [png, png, png], files: [{ name: "a.txt", mimeType: "text/plain", text: "a" }, { name: "b.txt", mimeType: "text/plain", text: "b" }] }), (e: any) => e.code === "too_many_attachments");
});

test("empty attachment arrays do not bypass the ordinary frame limit", () => {
  const frame = Buffer.from(JSON.stringify({ protocolVersion: 3, type: "command.request", command: { type: "prompt", text: "x".repeat(300 * 1024), files: [] } }));
  assert.throws(() => decodeTextFrame(frame, false), (e: any) => e.code === "message_too_large");
});
