const SECRET_KEY = /(?:token|authorization|auth|cookie|credential|password|passwd|secret|verifier|api[-_]?key|private[-_]?key|environment|env(?:ironment)?|prompt|message|content|attachment|bytes|data|path|cwd)/i;
const PRIVATE_PATH = /(?:[A-Za-z]:\\Users\\|\/(?:home|Users)\/)[^\s]+/g;
const QUERY_SECRET = /([?&](?:token|key|secret|auth|code|verifier)=)[^&#\s]*/gi;

export function redactForLog(value: unknown): unknown {
  const seen = new WeakSet<object>();
  const visit = (item: unknown, key?: string): unknown => {
    if (key && SECRET_KEY.test(key)) return "[redacted]";
    if (typeof item === "string") return item.replace(QUERY_SECRET, "$1[redacted]").replace(PRIVATE_PATH, "[private-path]");
    if (item === null || typeof item !== "object") return item;
    if (seen.has(item)) return "[circular]";
    seen.add(item);
    if (Array.isArray(item)) return item.map(child => visit(child));
    const output: Record<string, unknown> = {};
    let descriptors: PropertyDescriptorMap;
    try { descriptors = Object.getOwnPropertyDescriptors(item); }
    catch { return "[unavailable]"; }
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) continue;
      if (!("value" in descriptor)) output[name] = "[unavailable]";
      else output[name] = visit(descriptor.value, name);
    }
    return output;
  };
  return visit(value);
}

export type LoggableEvent = { eventId?: unknown; processId?: unknown; processInstanceId?: unknown; processSequence?: unknown; cursor?: unknown; eventType?: string };
export function toLoggableEvent(value: any): LoggableEvent {
  return { eventId: value?.eventId, processId: value?.processId, processInstanceId: value?.processInstanceId, processSequence: value?.processSequence, cursor: value?.cursor, eventType: typeof value?.event?.type === "string" ? value.event.type : undefined };
}
export type LoggableCommand = { commandId?: unknown; targetProcessId?: unknown; commandType?: string; status?: unknown };
export function toLoggableCommand(value: any): LoggableCommand {
  return { commandId: value?.commandId, targetProcessId: value?.targetProcessId, commandType: typeof value?.command?.type === "string" ? value.command.type : undefined, status: value?.status };
}
