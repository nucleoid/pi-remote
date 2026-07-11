import assert from "node:assert/strict"; import { test } from "node:test"; import { profilePaths } from "../src/paths.js";
test("profile paths use platform path semantics and injectable roots",()=>{const p=profilePaths("C:\\Users\\dev\\.pi\\agent","win32");assert.match(p.database,/control\.db$/);assert.match(p.lock,/daemon\.lock$/);assert.doesNotMatch(p.database,/~|undefined/);});
