import assert from "node:assert/strict";
import { test } from "node:test";
import { JsonlDecoder, encodeJsonl } from "../src/index.ts";

test("JSONL splits on LF, strips one CR, and preserves Unicode separators", () => {
  const decoder = new JsonlDecoder();
  const value = { text: "a\u2028b\u2029c" };
  assert.deepEqual(decoder.push(Buffer.from(`${JSON.stringify(value)}\r\n`)), [value]);
  assert.equal(encodeJsonl(value), `${JSON.stringify(value)}\n`);
});

test("JSONL handles split UTF-8 and bounds unterminated records", () => {
  const bytes = Buffer.from('{"text":"😀"}\n');
  const decoder = new JsonlDecoder();
  assert.deepEqual(decoder.push(bytes.subarray(0, 11)), []);
  assert.deepEqual(decoder.push(bytes.subarray(11)), [{ text: "😀" }]);
  assert.throws(() => new JsonlDecoder(4).push(Buffer.from("12345")), (e: any) => e.code === "jsonl_record_too_large");
});
