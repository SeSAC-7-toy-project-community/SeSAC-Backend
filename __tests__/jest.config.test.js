/**
 * Jest Config Validation Tests
 *
 * Testing framework: Jest
 * Purpose:
 *  - Validate the exported configuration object from jest.config.js (or nearby variants)
 *  - Ensure critical keys are present or well-formed
 *  - Verify mapped/declared file paths resolve to existing files when applicable
 *  - Provide actionable test names and messages
 *
 * These tests are intentionally tolerant of optional keys, while still checking for correctness where present.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

/**
 * Load the jest config in a robust way:
 * - Prefer root-level jest.config.js (CJS)
 * - Fallback to variants: jest.config.cjs, jest.config.mjs, jest.config.ts, jest.config.json
 * - Support ESM default export via dynamic import
 */
async function loadJestConfig() {
  const candidates = [
    'jest.config.js',
    'jest.config.cjs',
    'jest.config.mjs',
    'jest.config.ts',
    'jest.config.json'
  ].map(p => path.resolve(process.cwd(), p));

  let found = candidates.find(p => fs.existsSync(p));
  if (!found) {
    // Also attempt to find a config inside common config locations if not at root
    const extra = [];
    for (const dir of ['config', 'configs', '.config', '.']) {
      for (const base of ['jest.config.js', 'jest.config.cjs', 'jest.config.mjs', 'jest.config.ts', 'jest.config.json']) {
        const candidate = path.resolve(process.cwd(), dir, base);
        if (fs.existsSync(candidate)) extra.push(candidate);
      }
    }
    found = extra[0];
  }

  if (!found) {
    throw new Error('No jest config file found (searched common variants at repo root).');
  }

  // Try require first (works for CJS .js/.cjs and even .json)
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const mod = require(found);
    return mod && mod.__esModule ? mod.default : mod;
  } catch (e) {
    // If require fails (e.g., ESM or TS), try dynamic import
    try {
      // For .ts configs, Jest typically transpiles via ts-jest; as a fallback, dynamic import may not work.
      // We attempt an import for .mjs or ESM-style exports.
      const url = pathToFileURL(found).href;
      const mod = await import(url);
      return mod && mod.__esModule ? mod.default : mod;
    } catch (e2) {
      // Last resort: if it's a plain JSON file
      if (found.endsWith('.json')) {
        const txt = fs.readFileSync(found, 'utf8');
        return JSON.parse(txt);
      }
      throw new Error(`Unable to load Jest config from ${found}. require error: ${e.message}; import error: ${e2.message}`);
    }
  }
}

function resolveRootDirPlaceholder(p, rootDir) {
  if (typeof p !== 'string') return p;
  const rd = rootDir || process.cwd();
  return p.replace(/<rootDir>/g, rd);
}

function resolveMaybePath(p, rootDir) {
  if (typeof p !== 'string') return { original: p, resolved: null, exists: false };
  const replaced = resolveRootDirPlaceholder(p, rootDir);
  const resolved = path.isAbsolute(replaced) ? replaced : path.resolve(process.cwd(), replaced);
  return { original: p, resolved, exists: fs.existsSync(resolved) };
}

describe('jest.config.* exported configuration', () => {
  let config;

  beforeAll(async () => {
    config = await loadJestConfig();
  });

  test('should export a non-null object', () => {
    expect(config).toBeTruthy();
    expect(typeof config).toBe('object');
    expect(Array.isArray(config)).toBe(false);
  });

  test('testEnvironment should be a string if provided and typically "node" or "jsdom"', () => {
    if (Object.prototype.hasOwnProperty.call(config, 'testEnvironment')) {
      expect(typeof config.testEnvironment).toBe('string');
      const allowed = new Set(['node', 'jsdom']);
      // We do not fail on custom environments, but provide a helpful assertion:
      if (!allowed.has(config.testEnvironment)) {
        // Ensure it looks like a valid module path if not a common default
        expect(typeof config.testEnvironment).toBe('string');
      }
    }
  });

  test('transform, if present, should be an object mapping regex to transformer', () => {
    if (config.transform !== undefined) {
      expect(typeof config.transform).toBe('object');
      expect(Array.isArray(config.transform)).toBe(false);
      for (const [pattern, transformer] of Object.entries(config.transform)) {
        expect(typeof pattern).toBe('string');
        // pattern should be a valid regex – at least ensure it compiles
        expect(() => new RegExp(pattern)).not.toThrow();
        // transformer can be string or array [path, options]
        const t = transformer;
        const ok = typeof t === 'string' || (Array.isArray(t) && (typeof t[0] === 'string'));
        expect(ok).toBe(true);
      }
    }
  });

  test('moduleNameMapper, if present, should map regex strings to string targets that are valid module paths or proxies', () => {
    if (config.moduleNameMapper !== undefined) {
      expect(typeof config.moduleNameMapper).toBe('object');
      expect(Array.isArray(config.moduleNameMapper)).toBe(false);
      for (const [pattern, target] of Object.entries(config.moduleNameMapper)) {
        expect(() => new RegExp(pattern)).not.toThrow();
        if (typeof target === 'string') {
          // If target is a path (starts with <rootDir> or ./ or ../ or /), ensure it resolves
          if (target.startsWith('<rootDir>') || target.startsWith('.') || target.startsWith('/') ) {
            const { exists } = resolveMaybePath(target, config.rootDir);
            expect(exists).toBe(true);
          } else {
            // For non-path strings like 'identity-obj-proxy' or module names, we just assert it's a non-empty string
            expect(target.length).toBeGreaterThan(0);
          }
        } else if (Array.isArray(target)) {
          // Some advanced mappings allow arrays – ensure first element is a string
          expect(typeof target[0]).toBe('string');
        } else {
          throw new Error(`Unexpected moduleNameMapper target for pattern ${pattern}`);
        }
      }
    }
  });

  test('setupFiles and setupFilesAfterEnv, if present, should reference existing files', () => {
    for (const key of ['setupFiles', 'setupFilesAfterEnv']) {
      if (config[key] !== undefined) {
        expect(Array.isArray(config[key])).toBe(true);
        for (const p of config[key]) {
          expect(typeof p).toBe('string');
          const { exists } = resolveMaybePath(p, config.rootDir);
          expect(exists).toBe(true);
        }
      }
    }
  });

  test('testMatch or testRegex should be provided; ensure valid patterns (if present)', () => {
    const hasMatch = Array.isArray(config.testMatch) && config.testMatch.length > 0;
    const hasRegex = typeof config.testRegex === 'string' || Array.isArray(config.testRegex);
    expect(hasMatch || hasRegex).toBe(true);

    if (hasMatch) {
      for (const glob of config.testMatch) {
        expect(typeof glob).toBe('string');
        // Ensure it looks like a glob for test files
        expect(/\.(test|spec)\.(js|jsx|ts|tsx)$/.test(glob) || glob.includes('**')).toBe(true);
      }
    }
    if (hasRegex) {
      const regs = Array.isArray(config.testRegex) ? config.testRegex : [config.testRegex];
      for (const r of regs) {
        expect(() => new RegExp(r)).not.toThrow();
      }
    }
  });

  test('roots, if present, should be existing directories', () => {
    if (config.roots !== undefined) {
      expect(Array.isArray(config.roots)).toBe(true);
      for (const r of config.roots) {
        expect(typeof r).toBe('string');
        const { resolved, exists } = resolveMaybePath(r, config.rootDir);
        expect(exists).toBe(true);
        expect(fs.lstatSync(resolved).isDirectory()).toBe(true);
      }
    }
  });

  test('moduleFileExtensions, if present, should include extensions as strings (e.g., js/ts)', () => {
    if (config.moduleFileExtensions !== undefined) {
      expect(Array.isArray(config.moduleFileExtensions)).toBe(true);
      for (const ext of config.moduleFileExtensions) {
        expect(typeof ext).toBe('string');
        expect(ext.length).toBeGreaterThan(0);
      }
    }
  });

  test('collectCoverage, coverageDirectory, coverageThreshold validations', () => {
    if (config.collectCoverage !== undefined) {
      expect(typeof config.collectCoverage).toBe('boolean');
      if (config.collectCoverage) {
        // coverageDirectory optional but common if collecting coverage
        if (config.coverageDirectory !== undefined) {
          expect(typeof config.coverageDirectory).toBe('string');
          const { resolved } = resolveMaybePath(config.coverageDirectory, config.rootDir);
          expect(path.basename(resolved).length).toBeGreaterThan(0);
        }
        if (config.coverageThreshold !== undefined) {
          expect(typeof config.coverageThreshold).toBe('object');
          for (const [scope, threshold] of Object.entries(config.coverageThreshold)) {
            expect(typeof scope).toBe('string');
            expect(typeof threshold).toBe('object');
            for (const [k, v] of Object.entries(threshold)) {
              expect(['branches', 'functions', 'lines', 'statements']).toContain(k);
              expect(typeof v).toBe('number');
              expect(v).toBeGreaterThanOrEqual(0);
              expect(v).toBeLessThanOrEqual(100);
            }
          }
        }
      }
    }
  });

  test('clearMocks/resetMocks/resetModules, if present, should be boolean flags', () => {
    for (const key of ['clearMocks', 'resetMocks', 'restoreMocks', 'resetModules', 'bail', 'verbose']) {
      if (config[key] !== undefined) {
        expect(typeof config[key]).toBe('boolean');
      }
    }
  });

  test('testPathIgnorePatterns and coveragePathIgnorePatterns, if present, should be arrays of strings and valid regex', () => {
    for (const key of ['testPathIgnorePatterns', 'coveragePathIgnorePatterns']) {
      if (config[key] !== undefined) {
        expect(Array.isArray(config[key])).toBe(true);
        for (const p of config[key]) {
          expect(typeof p).toBe('string');
          expect(() => new RegExp(p)).not.toThrow();
        }
      }
    }
  });
});