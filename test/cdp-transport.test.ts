import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DevtoolsSession } from "../src/session";

test("real Playwright discovery preserves gateway prefix, token rotation and shared failure admission", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-devtools-cdp-"));
  const env = { ...process.env };
  const requests: { url: string | undefined; authorization: string | undefined }[] = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Synthetic gateway denied discovery");
  });
  const session = new DevtoolsSession();
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const file = join(dir, "token");
    await writeFile(file, "synthetic-file-token\n");
    process.env.PI_DEVTOOLS_CDP_URL = `http://127.0.0.1:${address.port}/cdp`;
    process.env.PI_DEVTOOLS_CDP_TOKEN_FILE = file;
    process.env.PI_DEVTOOLS_CDP_TOKEN = "ignored-environment-token";
    process.env.PI_DEVTOOLS_AUTO_LAUNCH = "0";
    process.env.PI_DEVTOOLS_PROFILE = join(dir, "unused-profile");
    const results = await Promise.allSettled([session.connect(), session.connect()]);
    for (const result of results) {
      assert.equal(result.status, "rejected");
      if (result.status === "rejected") {
        assert.match(result.reason.message, /Cannot reach Chrome DevTools/);
        assert.doesNotMatch(result.reason.message, /synthetic-file-token|ignored-environment-token/);
      }
    }
    assert.equal(requests.length, 1, "concurrent attaches share a single failed discovery");
    assert.match(requests[0].url!, /^\/cdp\/json\/version\/?$/);
    assert.equal(requests[0].authorization, "Bearer synthetic-file-token");
    assert.equal(session.isConnected(), false);

    await writeFile(file, "rotated-synthetic-token\n");
    await assert.rejects(session.connect(), /Cannot reach Chrome DevTools/);
    assert.equal(requests.length, 2, "later explicit attach is allowed after failure");
    assert.equal(requests[1].authorization, "Bearer rotated-synthetic-token");
  } finally {
    await session.close();
    process.env = env;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
