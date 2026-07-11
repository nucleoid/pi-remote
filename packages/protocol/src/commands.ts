import { Type, type Static } from "@sinclair/typebox";
import { UuidSchema } from "./ids.js";
import { MAX_ATTACHMENTS, MAX_TEXT_ATTACHMENT_BYTES, ProtocolError, validateCanonicalBase64, validateImageData, validateSchema } from "./validation.js";

const text = Type.String({ maxLength: 262144 });
const image = Type.Object({ name: Type.String({ minLength: 1, maxLength: 255 }), mimeType: Type.String({ maxLength: 128 }), data: Type.String({ maxLength: 7_000_000 }) });
const file = Type.Union([
  Type.Object({ name: Type.String({ minLength: 1, maxLength: 255 }), mimeType: Type.String({ maxLength: 128 }), text: Type.String({ maxLength: 204800 }) }),
  Type.Object({ name: Type.String({ minLength: 1, maxLength: 255 }), mimeType: Type.String({ maxLength: 128 }), encoding: Type.Literal("base64"), data: Type.String({ maxLength: 7_000_000 }) }),
]);
const commandSchemas = {
  prompt: Type.Object({ type: Type.Literal("prompt"), text, images: Type.Optional(Type.Array(image, { maxItems: 4 })), files: Type.Optional(Type.Array(file, { maxItems: 4 })), deliverAs: Type.Optional(Type.Union([Type.Literal("prompt"), Type.Literal("steer"), Type.Literal("follow_up")])) }),
  steer: Type.Object({ type: Type.Literal("steer"), text }),
  follow_up: Type.Object({ type: Type.Literal("follow_up"), text }),
  abort: Type.Object({ type: Type.Literal("abort") }),
  history: Type.Object({ type: Type.Literal("history"), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })) }),
  state: Type.Object({ type: Type.Literal("state") }),
  model: Type.Object({ type: Type.Literal("model"), provider: Type.String({ maxLength: 128 }), id: Type.String({ maxLength: 256 }) }),
  thinking: Type.Object({ type: Type.Literal("thinking"), level: Type.String({ maxLength: 64 }) }),
  queue_mode: Type.Object({ type: Type.Literal("queue_mode"), mode: Type.String({ maxLength: 64 }) }),
  retry: Type.Object({ type: Type.Literal("retry") }),
  compact: Type.Object({ type: Type.Literal("compact") }),
  pause: Type.Object({ type: Type.Literal("pause") }),
  resume: Type.Object({ type: Type.Literal("resume") }),
  tool_gate_decision: Type.Object({ type: Type.Literal("tool_gate_decision"), decision: Type.Union([Type.Literal("allow"), Type.Literal("deny")]), replacementArgs: Type.Optional(Type.Record(Type.String(), Type.Unknown())), persistable: Type.Optional(Type.Literal(false)) }),
  force_terminate: Type.Object({ type: Type.Literal("force_terminate") }),
} as const;
export const CommandBodySchema = Type.Union(Object.values(commandSchemas));
export type CommandBody = Static<typeof CommandBodySchema>;
export type UnknownCommand = { type: "unknown"; originalType: string; value: Record<string, unknown> };
export const CommandRequestSchema = Type.Object({ protocolVersion: Type.Literal(3), type: Type.Literal("command.request"), commandId: UuidSchema, targetProcessId: UuidSchema, sessionId: Type.Optional(UuidSchema), deadline: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z$", maxLength: 40 })), command: Type.Record(Type.String(), Type.Unknown()) });
export const CommandAckSchema = Type.Object({ protocolVersion: Type.Literal(3), type: Type.Literal("command.ack"), commandId: UuidSchema, status: Type.Union([Type.Literal("accepted"), Type.Literal("rejected")]), code: Type.Optional(Type.String({ maxLength: 64 })) });
export const CommandResultSchema = Type.Object({ protocolVersion: Type.Literal(3), type: Type.Literal("command.result"), commandId: UuidSchema, status: Type.Union([Type.Literal("completed"), Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("timed_out")]), result: Type.Optional(Type.Unknown()), error: Type.Optional(Type.Object({ code: Type.String({ maxLength: 64 }), message: Type.String({ maxLength: 2048 }) })) });

export function parseCommandBody(value: unknown): CommandBody | UnknownCommand {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as any).type !== "string") throw new ProtocolError("invalid_command", "command.type", "Command must be an object with a type");
  const type = (value as any).type as string;
  const schema = (commandSchemas as Record<string, any>)[type];
  if (!schema) return { type: "unknown", originalType: type, value: value as Record<string, unknown> };
  if (type === "prompt") prevalidatePromptEnvelope(value as Record<string, unknown>);
  const command = validateSchema(schema, value, "invalid_command") as CommandBody;
  if (command.type === "prompt") validatePromptAttachments(command);
  return command;
}

function prevalidatePromptEnvelope(command: any): void {
  const images = Array.isArray(command.images) ? command.images : [];
  const files = Array.isArray(command.files) ? command.files : [];
  if (images.length + files.length > MAX_ATTACHMENTS) throw new ProtocolError("too_many_attachments", undefined, `A prompt may contain at most ${MAX_ATTACHMENTS} attachments`);
  for (const item of [...images, ...files]) {
    if (typeof item?.data !== "string") continue;
    const padding = item.data.endsWith("==") ? 2 : item.data.endsWith("=") ? 1 : 0;
    const decodedLength = Math.floor(item.data.length / 4) * 3 - padding;
    if (decodedLength > 5 * 1024 * 1024) throw new ProtocolError("attachment_too_large", undefined, "Attachment exceeds decoded size limit");
  }
}

export function validatePromptAttachments(command: Extract<CommandBody, { type: "prompt" }>): void {
  const images = command.images ?? [];
  const files = command.files ?? [];
  if (images.length + files.length > MAX_ATTACHMENTS) throw new ProtocolError("too_many_attachments", undefined, `A prompt may contain at most ${MAX_ATTACHMENTS} attachments`);
  for (const item of images) validateImageData(item.mimeType, item.data);
  for (const item of files) {
    if ("encoding" in item) validateCanonicalBase64(item.data);
    else if (Buffer.byteLength(item.text, "utf8") > MAX_TEXT_ATTACHMENT_BYTES) throw new ProtocolError("text_attachment_too_large", undefined, "Text attachment exceeds 200 KiB");
  }
}

export function isPersistableCommand(command: CommandBody): boolean {
  return command.type !== "tool_gate_decision";
}
