export const KNOWN_CAPABILITIES = [
  "events.publish", "events.replay", "commands.prompt", "commands.steer", "commands.follow_up",
  "commands.abort", "commands.history", "commands.state", "commands.attachments", "commands.model",
  "commands.thinking", "commands.queue", "commands.retry", "commands.compaction", "commands.pause",
  "commands.tool_gate", "commands.force_terminate",
] as const;
export type KnownCapability = (typeof KNOWN_CAPABILITIES)[number];
const known = new Set<string>(KNOWN_CAPABILITIES);
export function intersectKnownCapabilities(offered: readonly string[], supported: readonly string[]): KnownCapability[] {
  const enabled = new Set(supported);
  return [...new Set(offered)].filter((value): value is KnownCapability => known.has(value) && enabled.has(value));
}
