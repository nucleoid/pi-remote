import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";

export const MAX_WEBSOCKET_PAYLOAD_BYTES = 32 * 1024 * 1024;
export const MAX_MESSAGE_BYTES = 256 * 1024;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_ATTACHMENT_BYTES = 200 * 1024;
export const MAX_ATTACHMENTS = 4;
export const MAX_ERROR_MESSAGE_BYTES = 2048;

export class ProtocolError extends Error {
  readonly closeCode: number;
  readonly path?: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, path?: string, message = "Protocol validation failed", closeCode = 1002, details?: Record<string, unknown>) {
    super(truncate(message, MAX_ERROR_MESSAGE_BYTES));
    this.name = "ProtocolError";
    this.code = code;
    this.path = path;
    this.closeCode = closeCode;
    this.details = details;
  }
  readonly code: string;
  toJSON() { return { code: this.code, ...(this.path ? { path: this.path } : {}), message: this.message }; }
}

function truncate(value: string, bytes: number): string {
  const buffer = Buffer.from(value);
  return buffer.length <= bytes ? value : buffer.subarray(0, bytes - 3).toString("utf8") + "...";
}

export function validateSchema<T>(schema: TSchema, value: unknown, code = "invalid_message"): T {
  if (Value.Check(schema, value)) return value as T;
  const first = Value.Errors(schema, value).First();
  throw new ProtocolError(code, first?.path || undefined, first?.message ?? "Payload does not match schema");
}

function objectDepth(value: unknown, depth = 0, seen = new Set<object>()): number {
  if (!value || typeof value !== "object") return depth;
  if (seen.has(value as object)) return depth;
  seen.add(value as object);
  let max = depth;
  for (const child of Object.values(value)) max = Math.max(max, objectDepth(child, depth + 1, seen));
  return max;
}

function attachmentEnvelope(value: any): boolean {
  if (value?.protocolVersion !== 3 || value?.type !== "command.request" || value?.command?.type !== "prompt") return false;
  const imageCount = Array.isArray(value.command.images) ? value.command.images.length : 0;
  const fileCount = Array.isArray(value.command.files) ? value.command.files.length : 0;
  return imageCount + fileCount > 0;
}

export function decodeTextFrame(data: Buffer | Uint8Array | string, isBinary: boolean): Record<string, unknown> {
  if (isBinary) throw new ProtocolError("binary_frame", undefined, "Binary WebSocket frames are not supported");
  const bytes = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  if (bytes.length > MAX_WEBSOCKET_PAYLOAD_BYTES) throw new ProtocolError("frame_too_large", undefined, "Frame exceeds 32 MiB");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new ProtocolError("invalid_utf8", undefined, "Frame is not valid UTF-8"); }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new ProtocolError("invalid_json", undefined, "Frame must contain exactly one JSON object"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProtocolError("invalid_json_object", undefined, "Frame must contain a JSON object");
  if (bytes.length > MAX_MESSAGE_BYTES && !attachmentEnvelope(value)) throw new ProtocolError("message_too_large", undefined, "Ordinary messages are limited to 256 KiB");
  if (objectDepth(value) > 32) throw new ProtocolError("object_too_deep", undefined, "Object nesting exceeds 32 levels");
  return value as Record<string, unknown>;
}

export function validateCanonicalBase64(value: string, maxDecodedBytes = MAX_ATTACHMENT_BYTES): Buffer {
  if (typeof value !== "string" || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new ProtocolError("invalid_base64", undefined, "Attachment data is not canonical base64");
  if (Math.floor(value.length / 4) * 3 > maxDecodedBytes + 2) throw new ProtocolError("attachment_too_large", undefined, "Attachment exceeds decoded size limit");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length > maxDecodedBytes || decoded.toString("base64") !== value) throw new ProtocolError(decoded.length > maxDecodedBytes ? "attachment_too_large" : "invalid_base64", undefined, "Attachment data is invalid or too large");
  return decoded;
}

const signatures: Record<string, readonly number[][]> = {
  "image/png": [[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]],
  "image/jpeg": [[0xff,0xd8,0xff]],
  "image/gif": [[0x47,0x49,0x46,0x38,0x37,0x61], [0x47,0x49,0x46,0x38,0x39,0x61]],
  "image/webp": [[0x52,0x49,0x46,0x46]],
};
export function validateImageData(mimeType: string, data: string): Buffer {
  const decoded = validateCanonicalBase64(data);
  const allowed = signatures[mimeType];
  if (!allowed || !allowed.some(signature => signature.every((byte, index) => decoded[index] === byte)) || (mimeType === "image/webp" && decoded.subarray(8, 12).toString("ascii") !== "WEBP")) throw new ProtocolError("invalid_image_signature", undefined, "Image content does not match its media type");
  return decoded;
}

export function canonicalJson(value: unknown): string {
  const visit = (item: any): any => Array.isArray(item) ? item.map(visit) : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map(key => [key, visit(item[key])])) : item;
  return JSON.stringify(visit(value));
}
