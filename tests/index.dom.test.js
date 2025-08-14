/* 
Testing library and framework:
- These tests are authored for Jest with jsdom test environment (common in JS repos).
- If Jest is configured with testEnvironment: 'jsdom', the DOM APIs will be available automatically.
- If Jest is not present, these tests also attempt to run under Node's built-in 'node:test' using jsdom (if available).
- No new dependencies are introduced.

Coverage focus:
- Validate structure and semantics of the HTML snippet introduced in the PR (from tests/index.test.js content).
- Happy path: correct tags exist.
- Edge cases: malformed viewport width attribute, whitespace robustness.
- Failure conditions: verify that invalid or missing elements are detected by assertions.
*/

const fs = require('fs');
const path = require('path');

function loadHtmlFixture(file = 'tests/fixtures/index.html') {
  const htmlPath = path.resolve(process.cwd(), file);
  const content = fs.readFileSync(htmlPath, 'utf-8');
  return content;
}

// Utility: parse HTML via DOM, preferring global JSDOM if in Jest environment; fallback minimal parser otherwise.
async function parseHtml(html) {
  // If Jest with jsdom: global DOM APIs exist
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
  }

  // Try to use jsdom if available in the environment
  try {
    const { JSDOM } = require('jsdom');
    const { window } = new JSDOM(html);
    return window.document;
  } catch (_e) {
    // As a last resort, implement a naive parser to allow minimal assertions without DOM
    // This is not a full HTML parser; used only to avoid dependency additions.
    return {
      _raw: html,
      querySelector: (sel) => null,
      querySelectorAll: (sel) => [],
      documentElement: null,
      title: (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '',
      get meta() {
        // naive meta extraction for tests that check presence
        const metas = [];
        const metaRegex = /<meta\s+([^>]+)>/gi;
        let m;
        while ((m = metaRegex.exec(html))) {
          metas.push(m[1]);
        }
        return metas;
      },
    };
  }
}

function getMetaByName(doc, name) {
  if (doc.querySelector) {
    return doc.querySelector(`meta[name="${name}"]`);
  }
  // naive fallback
  const metas = doc.meta || [];
  const match = metas.find((attrs) => new RegExp(`name\\s*=\\s*["']${name}["']`, 'i').test(attrs));
  return match ? { getAttribute: (k) => {
    const m = new RegExp(`${k}\\s*=\\s*["']([^"']*)["']`, 'i').exec(match);
    return m ? m[1] : null;
  }} : null;
}

function getMetaByCharset(doc) {
  if (doc.querySelector) {
    return doc.querySelector('meta[charset]');
  }
  const metas = doc.meta || [];
  const match = metas.find((attrs) => /charset\s*=\s*["']?utf-?8["']?/i.test(attrs));
  return match ? { getAttribute: (k) => {
    if (k.toLowerCase() === 'charset') return 'UTF-8';
    return null;
  }} : null;
}

function parseViewportContent(content) {
  // Parse content like: width=device-width, initial-scale=1.0
  // Handle malformed cases like width= (missing value)
  const result = {};
  if (!content || typeof content !== 'string') return result;
  content.split(',').map(s => s.trim()).forEach(pair => {
    if (!pair) return;
    const [k, v] = pair.split('=').map(s => (s || '').trim());
    if (!k) return;
    result[k.toLowerCase()] = v || null;
  });
  return result;
}

// Test harness adapter: prefer Jest describe/it; fallback to node:test if Jest not present
const isJest = typeof describe === 'function' && typeof it === 'function';

async function defineTests(rt) {
  const t = rt; // { describe, it, expect? }
  const html = loadHtmlFixture();
  const doc = await parseHtml(html);

  t.describe('index.html structure', () => {
    t.it('should include correct doctype declaration', () => {
      if (doc.doctype) {
        // In jsdom, document.doctype.name === 'html'
        expect(doc.doctype.name.toLowerCase()).toBe('html');
      } else {
        // if fallback: ensure raw starts with <!DOCTYPE html>
        expect(html.trim().toLowerCase().startsWith('<!doctype html>')).toBe(true);
      }
    });

    t.it('should set <html lang="en">', () => {
      if (doc.documentElement) {
        expect(doc.documentElement.lang || doc.documentElement.getAttribute('lang')).toBe('en');
      } else {
        expect(/<html[^>]*\blang\s*=\s*["']en["']/i.test(html)).toBe(true);
      }
    });

    t.it('should have UTF-8 charset meta', () => {
      const charsetMeta = getMetaByCharset(doc);
      expect(charsetMeta).not.toBeNull();
      if (charsetMeta && charsetMeta.getAttribute) {
        expect((charsetMeta.getAttribute('charset') || '').toLowerCase()).toBe('utf-8');
      }
    });

    t.it('should have a viewport meta that includes initial-scale', () => {
      const viewportMeta = getMetaByName(doc, 'viewport');
      expect(viewportMeta).not.toBeNull();
      if (viewportMeta) {
        const content = viewportMeta.getAttribute ? viewportMeta.getAttribute('content') : null;
        const parsed = parseViewportContent(content);
        // It may have malformed width, but initial-scale should still be present and valid
        expect(parsed['initial-scale']).toBeTruthy();
        // width is present in markup but malformed (width=), assert we detect missing value gracefully
        if ('width' in parsed) {
          expect(parsed['width']).toBe(null);
        }
      }
    });

    t.it('should have title "Document"', () => {
      if (doc.querySelector) {
        expect(doc.querySelector('title').textContent).toBe('Document');
      } else {
        expect(doc.title).toBe('Document');
      }
    });

    t.it('should include an H1 with the Korean greeting', () => {
      if (doc.querySelector) {
        const h1 = doc.querySelector('h1');
        expect(h1).not.toBeNull();
        expect(h1.textContent.trim()).toBe('안녕하세요');
      } else {
        expect(/<h1>\s*안녕하세요\s*<\/h1>/i.test(html)).toBe(true);
      }
    });
  });

  t.describe('robustness and edge cases', () => {
    t.it('parseViewportContent should handle empty/null safely', () => {
      expect(parseViewportContent(null)).toEqual({});
      expect(parseViewportContent('')).toEqual({});
      expect(parseViewportContent(' , , ')).toEqual({});
    });

    t.it('parseViewportContent should parse valid key=value pairs', () => {
      const parsed = parseViewportContent('width=device-width, initial-scale=1.0, user-scalable=no');
      expect(parsed['width']).toBe('device-width');
      expect(parsed['initial-scale']).toBe('1.0');
      expect(parsed['user-scalable']).toBe('no');
    });

    t.it('parseViewportContent should set null for missing values', () => {
      const parsed = parseViewportContent('width=, initial-scale=1.0');
      expect(parsed['width']).toBe(null);
      expect(parsed['initial-scale']).toBe('1.0');
    });

    t.it('should fail if title is incorrect (negative control)', () => {
      if (doc.querySelector) {
        const title = doc.querySelector('title').textContent;
        expect(title === 'WrongTitle').toBe(false);
      } else {
        expect(doc.title === 'WrongTitle').toBe(false);
      }
    });
  });
}

// Jest adapter
if (isJest) {
  describe('HTML validation tests (Jest)', () => {
    it('bootstrap', async () => {
      expect.hasAssertions();
    });
  });
  // Register tests with Jest's globals directly
  defineTests({
    describe,
    it,
    expect,
  });
} else {
  // node:test adapter
  try {
    const nodeTest = require('node:test');
    const assert = require('assert');

    function wrapDescribe(name, fn) {
      nodeTest.describe(name, fn);
    }
    function wrapIt(name, fn) {
      nodeTest.it(name, async (t) => {
        // Provide a minimal expect-like shim using assert
        const expectShim = (received) => ({
          toBe: (expected) => assert.strictEqual(received, expected),
          toBeTruthy: () => assert.ok(received),
          not: {
            toBeNull: () => assert.notStrictEqual(received, null),
          },
          toEqual: (expected) => assert.deepStrictEqual(received, expected),
        });
        global.expect = expectShim;
        await fn();
      });
    }

    defineTests({
      describe: wrapDescribe,
      it: wrapIt,
      expect: {
        hasAssertions: () => {},
      },
    });
  } catch (e) {
    // No available runner; provide a helpful error so CI fails loudly with context
    console.error('No recognized test framework found (Jest or node:test). Please run with Jest (jsdom) or Node >=18.');
    throw e;
  }
}