import assert from "node:assert/strict";
import { test } from "node:test";
import { negotiateHello, ProtocolError, ProtocolSession } from "../src/index.ts";

const hello = { protocolVersion: 3, type: "hello", role: "bridge", supportedVersions: [2, 3], capabilities: ["events.replay", "future.capability"] };

test("negotiation selects the highest common version and known capability intersection", () => {
  assert.deepEqual(negotiateHello(hello, [3], ["events.replay", "commands.prompt"]), {
    protocolVersion: 3, type: "welcome", selectedVersion: 3, capabilities: ["events.replay"],
  });
});

test("negotiation rejects malformed known messages and no common version", () => {
  assert.throws(() => negotiateHello({ ...hello, supportedVersions: [] }, [3], []), ProtocolError);
  assert.throws(() => negotiateHello({ ...hello, capabilities: Array(65).fill("events.replay") }, [3], []), (error: any) => error.code === "invalid_hello");
  assert.throws(() => negotiateHello(hello, [4], []), (error: any) => error.code === "no_common_version" && error.closeCode === 1002);
});

test("post-welcome known messages use their exported schemas", () => {
  const session = new ProtocolSession([3], []);
  session.receive(hello);
  assert.throws(() => session.receive({ protocolVersion: 3, type: "process.register" }), (error: any) => error.code === "invalid_process_register");
});
