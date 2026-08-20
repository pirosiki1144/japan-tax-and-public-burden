import test from "node:test";
import assert from "node:assert/strict";
import { fetchSourcePages, SourceFetchError } from "../scripts/fetch/http-fetcher.js";

const source = {
  base_url: "https://example.go.jp/",
  entry_urls: ["https://example.go.jp/source"],
  accepted_content_types: ["text/html"]
};

test("temporary URL failures are retried before succeeding", async () => {
  let attempts = 0;
  const pages = await fetchSourcePages(source, {
    fetchImpl: async () => {
      attempts += 1;
      return attempts < 3 ? new Response("temporary", { status: 503 }) : new Response("official", { status: 200, headers: { "content-type": "text/html" } });
    },
    sleep: async () => {},
    now: () => new Date("2026-08-17T01:02:03Z")
  });
  assert.equal(attempts, 3);
  assert.equal(pages[0].body, "official");
});

test("permanent URL failures stop without retrying", async () => {
  let attempts = 0;
  await assert.rejects(fetchSourcePages(source, {
    fetchImpl: async () => {
      attempts += 1;
      return new Response("missing", { status: 404 });
    },
    sleep: async () => {}
  }), (error) => error instanceof SourceFetchError && error.code === "url_permanent_failure");
  assert.equal(attempts, 1);
});

test("binary PDF bytes are hashed and retained without UTF-8 decoding", async () => {
  const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0xff]);
  const pages = await fetchSourcePages({
    base_url: "https://example.go.jp/",
    entry_urls: ["https://example.go.jp/source.pdf"],
    accepted_content_types: ["application/pdf"]
  }, {
    fetchImpl: async () => new Response(bytes, { status: 200, headers: { "content-type": "application/pdf" } }),
    now: () => new Date("2026-08-21T03:00:00Z")
  });
  assert.equal(pages[0].body, undefined);
  assert.deepEqual(pages[0].bytes, bytes);
  assert.match(pages[0].sha256, /^[a-f0-9]{64}$/);
});
