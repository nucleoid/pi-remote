import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { loadOrCreateCredentials } from "../src/credentials.js";
import { tempProfile } from "./helpers.js";

test("credential creation is atomic and corrupt credentials are explicitly recovered", () => {
  const profile = tempProfile();
  try {
    const path = `${profile.path}/credentials.json`;
    writeFileSync(path, "{truncated");
    const credentials = loadOrCreateCredentials(path);
    assert.equal(typeof credentials.key, "string");
    assert.equal(typeof credentials.adminToken, "string");
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), credentials);
    assert.equal(existsSync(`${path}.corrupt`), true);
    assert.equal(readFileSync(`${path}.corrupt`, "utf8"), "{truncated");
    assert.equal(existsSync(`${path}.tmp`), false);
  } finally { profile.cleanup(); }
});
