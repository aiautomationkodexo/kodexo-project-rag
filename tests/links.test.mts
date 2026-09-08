import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLinks, linkLabel, MAX_LINKS_PER_PROJECT } from "@/lib/projects/links";

test("parses a bare URL", () => {
  assert.deepEqual(parseLinks("https://example.com/a"), [
    { url: "https://example.com/a", title: null },
  ]);
});

test("parses the three documented forms", () => {
  const input = [
    "https://example.com/plain",
    "Aurora case study — https://example.com/aurora",
    "[Press release](https://example.com/press)",
  ].join("\n");

  assert.deepEqual(parseLinks(input), [
    { url: "https://example.com/plain", title: null },
    { url: "https://example.com/aurora", title: "Aurora case study" },
    { url: "https://example.com/press", title: "Press release" },
  ]);
});

test("accepts en dash, hyphen, pipe and colon as separators", () => {
  for (const sep of ["—", "–", "-", "|", ":"]) {
    assert.deepEqual(
      parseLinks(`Title ${sep} https://example.com/x`),
      [{ url: "https://example.com/x", title: "Title" }],
      `separator ${sep}`,
    );
  }
});

/**
 * The format contract: a line with no URL is IGNORED, not an error. A pasted
 * block routinely carries a heading or a blank line, and failing the whole
 * submission over one would be hostile.
 */
test("lines with no URL are ignored, not errors", () => {
  const input = [
    "Case studies:",
    "",
    "   ",
    "notaurl",
    "https://example.com/real",
    "see also",
  ].join("\n");

  assert.deepEqual(parseLinks(input), [
    { url: "https://example.com/real", title: null },
  ]);
});

/**
 * SECURITY, not formatting. These strings end up in an href, and React escapes
 * text but does NOT sanitise href — a stored `javascript:` URL is stored XSS.
 */
test("rejects every non-http(s) scheme", () => {
  const hostile = [
    "[click](javascript:alert(1))",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "mailto:someone@example.com",
    "vbscript:msgbox(1)",
  ];
  for (const line of hostile) {
    assert.deepEqual(parseLinks(line), [], line);
  }
});

test("does not invent a scheme for a bare domain", () => {
  // Guessing https:// would write a URL the user never typed.
  assert.deepEqual(parseLinks("example.com/a"), []);
  assert.deepEqual(parseLinks("//example.com/a"), []);
});

test("strips trailing prose punctuation", () => {
  assert.deepEqual(parseLinks("see https://example.com/a."), [
    { url: "https://example.com/a", title: null },
  ]);
  assert.deepEqual(parseLinks("(https://example.com/b)"), [
    { url: "https://example.com/b", title: null },
  ]);
});

test("de-duplicates within one paste, first occurrence wins", () => {
  const input = [
    "Titled — https://example.com/same",
    "https://example.com/same",
    "https://EXAMPLE.com/same",
  ].join("\n");

  const out = parseLinks(input);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.title, "Titled", "the titled line must survive");
});

test("text after the URL is not treated as a title", () => {
  assert.deepEqual(parseLinks("https://example.com/a — some note"), [
    { url: "https://example.com/a", title: null },
  ]);
});

test("a markdown title may be empty", () => {
  assert.deepEqual(parseLinks("[](https://example.com/a)"), [
    { url: "https://example.com/a", title: null },
  ]);
});

test("empty and whitespace-only input yields nothing", () => {
  for (const input of ["", "\n", "   \n\t\n"]) {
    assert.deepEqual(parseLinks(input), []);
  }
});

test("handles both newline styles", () => {
  const crlf = "https://example.com/a\r\nhttps://example.com/b";
  assert.equal(parseLinks(crlf).length, 2);
});

test("linkLabel prefers the title, then the bare host", () => {
  assert.equal(linkLabel({ url: "https://x.com/a", title: "Title" }), "Title");
  assert.equal(linkLabel({ url: "https://www.example.com/a", title: null }), "example.com");
  assert.equal(linkLabel({ url: "https://sub.example.com/a", title: null }), "sub.example.com");
  // Never throws in render, even on something unparseable.
  assert.equal(linkLabel({ url: "!!!", title: null }), "!!!");
});

test("the cap is a positive integer", () => {
  assert.ok(Number.isInteger(MAX_LINKS_PER_PROJECT));
  assert.ok(MAX_LINKS_PER_PROJECT > 0);
});
