import { ProtocolError, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_TEXT_ATTACHMENT_BYTES, validateCanonicalBase64, validateImageData } from "./validation.js";

export const V2_COMMAND_TYPES = ["ping", "get_state", "get_history", "prompt", "steer", "follow_up", "followUp", "abort"] as const;

export function fromV2Command(value: any): { id?: unknown; command: Record<string, unknown> } {
  if (!value || typeof value !== "object" || typeof value.type !== "string") throw new ProtocolError("invalid_v2_command");
  const base = value.id === undefined ? {} : { id: value.id };
  switch (value.type) {
    case "ping": return { ...base, command: { type: "state", ping: true } };
    case "get_state": return { ...base, command: { type: "state" } };
    case "get_history": return { ...base, command: { type: "history", ...(value.limit === undefined ? {} : { limit: value.limit }) } };
    case "prompt": return { ...base, command: { type: "prompt", text: value.text ?? "", ...(value.images ? { images: value.images } : {}), ...(value.files ? { files: value.files } : {}), ...(value.deliverAs ? { deliverAs: value.deliverAs === "followUp" ? "follow_up" : value.deliverAs } : {}) } };
    case "steer": return { ...base, command: { type: "steer", text: value.text ?? "" } };
    case "follow_up":
    case "followUp": return { ...base, command: { type: "follow_up", text: value.text ?? "" } };
    case "abort": return { ...base, command: { type: "abort" } };
    default: throw new ProtocolError("unknown_v2_command", "type", "Unknown v2 command");
  }
}

export function validateV2Attachments(value: any): void {
  const images = Array.isArray(value?.images) ? value.images : [];
  const files = Array.isArray(value?.files) ? value.files : [];
  if (images.length + files.length > MAX_ATTACHMENTS) throw new ProtocolError("too_many_attachments");
  for (const image of images) validateImageData(image.mimeType, image.data);
  for (const file of files) {
    if (file.encoding === "base64") validateCanonicalBase64(file.data, MAX_ATTACHMENT_BYTES);
    else if (typeof file.text !== "string" || Buffer.byteLength(file.text) > MAX_TEXT_ATTACHMENT_BYTES) throw new ProtocolError("invalid_text_attachment");
  }
}

export function toV2Event(event: any): Record<string, unknown> | undefined {
  if (!event || typeof event.type !== "string") return undefined;
  if (event.type === "agent_end") return undefined;
  if (event.type === "agent_settled") return event.state?.isIdle === true ? { type: "agent_end", state: event.state } : undefined;
  const direct = new Set(["assistant_delta", "thinking_delta", "tool_call", "tool_start", "tool_update", "tool_end", "user_message", "assistant_message", "agent_start", "queue_update", "session_start", "session_shutdown", "client_count", "history", "response", "error"]);
  return direct.has(event.type) ? { ...event } : undefined;
}

export function v2Hello(state: Record<string, unknown>): Record<string, unknown> {
  return { type: "hello", server: "pi-remote-control", protocolVersion: 2, capabilities: { binaryFileAttachments: true }, state };
}
