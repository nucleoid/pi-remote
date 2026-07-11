import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fromV2Command, V2_COMMAND_TYPES } from "../src/index.ts";

const fixture = (name: string) => readFileSync(new URL(`../../../app/src/test/resources/protocol-v2/${name}`, import.meta.url), "utf8");

test("shared fixtures preserve Android v2 hello, history, lifecycle, tools, and commands", () => {
  const hello = JSON.parse(fixture("hello.json"));
  const history = JSON.parse(fixture("history.json"));
  assert.equal(hello.protocolVersion, 2);
  assert.equal(hello.server, "pi-remote-control");
  assert.equal(history.type, "history");
  const events = fixture("lifecycle.jsonl").trim().split("\n").concat(fixture("tools.jsonl").trim().split("\n")).map(JSON.parse);
  assert.ok(events.some((x: any) => x.type === "agent_end"));
  const commands = fixture("commands.jsonl").trim().split("\n").map(JSON.parse);
  assert.deepEqual(new Set(commands.map((x: any) => x.type)), new Set(V2_COMMAND_TYPES));
  assert.equal(fromV2Command(commands.find((x: any) => x.type === "followUp")!).command.type, "follow_up");
});

test("attachment fixture keeps text, image, binary and envelope boundaries", () => {
  const value = JSON.parse(fixture("attachments.json"));
  assert.equal(value.maxAttachments, 4);
  assert.equal(value.maxOutboundBytes, 15 * 1024 * 1024);
  assert.ok(value.prompt.images.length && value.prompt.files.length === 2);
});
