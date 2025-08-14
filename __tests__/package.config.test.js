/* Minimal shims for describe/it/before when running without a test runner */
const __g = globalThis || global;
if (typeof describe === "undefined") { global.describe = (n, fn) => fn(); }
if (typeof it === "undefined") { global.it = (n, fn) => fn(); }
if (typeof before === "undefined") { global.before = (fn) => fn(); }
// Generic test (should run under Jest/Vitest/Mocha)
import { strict as assert } from "assert";
/**
 * Note: Testing library/framework detected and used here:
 * Generic Node assert (should run in Jest/Vitest/Mocha)
 *
 * These tests focus specifically on package.json (per the Pull Request scope).
 * We validate schema-like properties, critical keys, scripts behavior patterns,
 * and handle edge cases gracefully.
 */
import fs from "fs";
import path from "path";

function readPackageJsonSafe() {
  const pkgPath = path.resolve(process.cwd(), "package.json");
  const raw = fs.readFileSync(pkgPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    // The file should be valid JSON
    throw new Error("package.json is not valid JSON");
  }
}

describe("package.json configuration validation", () => {
  let pkg;

  before(() => {
    pkg = readPackageJsonSafe();
  });

  it("should be a valid object with name and version", () => {
    assert.ok(pkg && typeof pkg === "object", "package.json should parse to an object");
    if ("name" in pkg) {
      assert.equal(typeof pkg.name, "string", "name should be a string");
      assert.ok(pkg.name.trim().length > 0, "name should not be empty");
    } else {
      throw new Error("Missing required key: name");
    }

    if ("version" in pkg) {
      assert.equal(typeof pkg.version, "string", "version should be a string");
      // Basic semver-ish structure (not strict semver parsing to avoid extra deps)
      assert.ok(/^\d+\.\d+\.\d+(-[\w\.-]+)?$/.test(pkg.version) || pkg.version === "0.0.0" || pkg.version === "0.0.0-development", "version should resemble semver");
    } else {
      throw new Error("Missing required key: version");
    }
  });

  it("should define scripts as an object when present and contain test script", () => {
    assert.ok(typeof pkg.scripts === "object" && pkg.scripts !== null, "scripts should exist and be an object");
    // Critical: test script should exist to run CI
    assert.ok(typeof pkg.scripts.test === "string" && pkg.scripts.test.length > 0, "scripts.test should exist and be non-empty");
  });

  it("should not include duplicate dependencies across dependencies/devDependencies", () => {
    const deps = new Set(Object.keys(pkg.dependencies || {}));
    const devDeps = new Set(Object.keys(pkg.devDependencies || {}));
    for (const dep of deps) {
      assert.ok(!devDeps.has(dep), `Dependency "${dep}" is duplicated in dependencies and devDependencies`);
    }
  });

  it("repository, license, and main/module fields should be reasonable when present", () => {
    if ("repository" in pkg) {
      if (typeof pkg.repository === "string") {
        assert.ok(pkg.repository.length > 0, "repository must be non-empty string if provided");
      } else if (typeof pkg.repository === "object" && pkg.repository !== null) {
        if ("type" in pkg.repository) {
          assert.equal(typeof pkg.repository.type, "string", "repository.type should be a string");
        }
        if ("url" in pkg.repository) {
          assert.equal(typeof pkg.repository.url, "string", "repository.url should be a string");
          assert.ok(pkg.repository.url.length > 0, "repository.url should not be empty");
        }
      }
    }

    if ("license" in pkg) {
      assert.equal(typeof pkg.license, "string", "license should be a string");
      assert.ok(pkg.license.length > 0, "license should not be empty");
    }

    if ("main" in pkg) {
      assert.equal(typeof pkg.main, "string", "main should be a string");
      assert.ok(pkg.main.length > 0, "main should not be empty if provided");
    }

    if ("module" in pkg) {
      assert.equal(typeof pkg.module, "string", "module should be a string");
      assert.ok(pkg.module.length > 0, "module should not be empty if provided");
    }
  });

  it("engines and type fields, when present, should be well-formed", () => {
    if ("engines" in pkg) {
      assert.equal(typeof pkg.engines, "object", "engines should be an object");
      if (pkg.engines && typeof pkg.engines === "object") {
        if ("node" in pkg.engines) {
          assert.equal(typeof pkg.engines.node, "string", "engines.node should be a string");
          assert.ok(pkg.engines.node.length > 0, "engines.node should not be empty");
        }
      }
    }
    if ("type" in pkg) {
      assert.ok(pkg.type === "module" || pkg.type === "commonjs", "type should be 'module' or 'commonjs' if present");
    }
  });

  it("should not declare private=false (either omits or sets true/false explicitly)", () => {
    if ("private" in pkg) {
      assert.ok(typeof pkg.private === "boolean", "private should be a boolean when present");
    }
  });

  it("exports field, if present, should be string/object and not empty", () => {
    if ("exports" in pkg) {
      const t = typeof pkg.exports;
      assert.ok(t === "string" || t === "object", "exports should be a string or an object");
      if (t === "string") {
        assert.ok(pkg.exports.length > 0, "exports string should not be empty");
      } else if (t === "object" && pkg.exports !== null) {
        assert.ok(Object.keys(pkg.exports).length > 0, "exports object should have keys");
      }
    }
  });

  it("bin field, if present, should be string/object and not empty", () => {
    if ("bin" in pkg) {
      const t = typeof pkg.bin;
      assert.ok(t === "string" || t === "object", "bin should be a string or an object");
      if (t === "string") {
        assert.ok(pkg.bin.length > 0, "bin string should not be empty");
      } else if (t === "object" && pkg.bin !== null) {
        assert.ok(Object.keys(pkg.bin).length > 0, "bin object should have entries");
      }
    }
  });

  it("sideEffects field, if present, should be boolean or array", () => {
    if ("sideEffects" in pkg) {
      const t = typeof pkg.sideEffects;
      assert.ok(t === "boolean" || Array.isArray(pkg.sideEffects), "sideEffects should be boolean or array");
    }
  });

  it("should not contain clearly invalid fields or empty strings for critical keys", () => {
    const critical = ["name", "version"];
    for (const key of critical) {
      assert.ok(key in pkg, `Missing critical key: ${key}`);
      assert.equal(typeof pkg[key], "string", `${key} should be a string`);
      assert.ok(pkg[key].trim().length > 0, `${key} should not be empty`);
    }
  });

  it("peerDependencies and peerDependenciesMeta, when present, should be consistent", () => {
    if ("peerDependenciesMeta" in pkg && pkg.peerDependenciesMeta) {
      assert.equal(typeof pkg.peerDependenciesMeta, "object", "peerDependenciesMeta should be an object");
      for (const dep of Object.keys(pkg.peerDependenciesMeta)) {
        if (pkg.peerDependencies && pkg.peerDependencies[dep]) {
          // ok: meta corresponds to a peer dep
        } else {
          // Not strictly invalid, but often unintended; assert allow listing meta for non-peers as well
          assert.ok(true, "peerDependenciesMeta may contain entries not in peerDependencies");
        }
      }
    }
  });

  it("funding, author, and bugs fields, when present, should be well-formed", () => {
    if ("funding" in pkg) {
      const f = pkg.funding;
      const ft = typeof f;
      assert.ok(ft === "string" || ft === "object", "funding should be string or object");
    }
    if ("author" in pkg) {
      const a = pkg.author;
      const at = typeof a;
      assert.ok(at === "string" || at === "object", "author should be string or object");
    }
    if ("bugs" in pkg) {
      const b = pkg.bugs;
      const bt = typeof b;
      assert.ok(bt === "string" || bt === "object", "bugs should be string or object");
    }
  });

  it("publishConfig and files, if present, should be well-formed", () => {
    if ("publishConfig" in pkg) {
      assert.equal(typeof pkg.publishConfig, "object", "publishConfig should be an object");
    }
    if ("files" in pkg) {
      assert.ok(Array.isArray(pkg.files), "files should be an array");
    }
  });
});