import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  assertPublicUrl,
  fetchPublicResource,
  isPublicIp,
  type HostLookup,
} from "../src/lib/public-url";
import { serializeJsonForHtml } from "../src/lib/json-ld";
import { parseGitHubRepo } from "../src/lib/fetchers";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const publicLookup: HostLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("public address classification blocks local and reserved ranges", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isPublicIp(address), false, address);
  }
  assert.equal(isPublicIp("93.184.216.34"), true);
  assert.equal(isPublicIp("2606:4700:4700::1111"), true);
});

test("URL validation checks all resolved addresses", async () => {
  await assert.rejects(() => assertPublicUrl("http://localhost/example"), /private hostname/);
  await assert.rejects(
    () => assertPublicUrl("https://example.test", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
    /non-public address/,
  );
  assert.equal((await assertPublicUrl("https://example.test/path", publicLookup)).hostname, "example.test");
});

test("bounded fetch validates redirects before following them", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/admin" },
    });
  };

  await assert.rejects(
    () => fetchPublicResource("https://example.test", { lookup: publicLookup }),
    /non-public address/,
  );
  assert.equal(calls, 1);
});

test("bounded fetch rejects streaming bodies over the byte limit", async () => {
  globalThis.fetch = async () => new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    }),
    { status: 200 },
  );

  await assert.rejects(
    () => fetchPublicResource("https://example.test", {
      lookup: publicLookup,
      maxBytes: 4,
    }),
    /exceeded 4 bytes/,
  );
});

test("GitHub parsing accepts repository URLs without trusting lookalike hosts", () => {
  assert.deepEqual(parseGitHubRepo("https://www.github.com/openai/codex.git/?tab=readme"), {
    owner: "openai",
    repo: "codex",
  });
  assert.equal(parseGitHubRepo("https://github.com.evil.example/openai/codex"), null);
  assert.equal(parseGitHubRepo("https://github.com/explore/topics"), null);
  assert.equal(parseGitHubRepo("javascript:alert(1)"), null);
});

test("inline JSON serialization cannot close its script element", () => {
  const serialized = serializeJsonForHtml({
    title: "</script><script>alert(1)</script>",
    separator: "\u2028",
  });
  assert.equal(serialized.includes("</script>"), false);
  assert.match(serialized, /\\u003c\/script\\u003e/);
  assert.match(serialized, /\\u2028/);
});
