import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const root = new URL("../../../", import.meta.url);

test("one root workspace lock owns protocol and extension installs", () => {
  const packageJson = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.deepEqual(packageJson.workspaces, ["packages/*", "pi-extension/*"]);
  assert.equal(existsSync(new URL("package-lock.json", root)), true);
  assert.equal(existsSync(new URL("pi-extension/remote-control/package-lock.json", root)), false);
});

test("root Pi package and independently published packages retain their manifests", () => {
  const rootPackage = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  const extension = JSON.parse(readFileSync(new URL("pi-extension/remote-control/package.json", root), "utf8"));
  const protocol = JSON.parse(readFileSync(new URL("packages/protocol/package.json", root), "utf8"));
  assert.equal(rootPackage.pi.extensions[0], "./pi-extension/remote-control/index.ts");
  assert.equal(extension.name, "@pragmaticcoder/pi-remote-control");
  assert.equal(protocol.name, "@nucleoid/pi-remote-protocol");

  const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: new URL(".", root), encoding: "utf8", shell: process.platform === "win32" }));
  assert.ok(packed[0].files.some((file: any) => file.path === "pi-extension/remote-control/index.ts"));
});
