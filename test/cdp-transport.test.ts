import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DevtoolsSession } from "../src/session";

// Exercise the real Playwright WebSocket upgrade path without launching Chrome
// or touching a user profile; discovery alone does not establish a connection.
test("rejected authenticated WebSocket upgrade leaves no connected session", async () => {
  const env = { ...process.env };
  const upgrades: { url: string | undefined; authorization: string | undefined }[] = [];
  let websocketUrl = "";
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ webSocketDebuggerUrl: websocketUrl }));
  });
  server.on("upgrade", (req, socket) => {
    upgrades.push({ url: req.url, authorization: req.headers.authorization });
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
  const session = new DevtoolsSession();
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    websocketUrl = `ws://127.0.0.1:${address.port}/cdp/devtools/browser/synthetic`;
    process.env.PI_DEVTOOLS_CDP_URL = `http://127.0.0.1:${address.port}/cdp`;
    process.env.PI_DEVTOOLS_CDP_TOKEN = "synthetic-websocket-token";
    delete process.env.PI_DEVTOOLS_CDP_TOKEN_FILE;
    process.env.PI_DEVTOOLS_AUTO_LAUNCH = "0";
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(session.connect(), (error: Error) => {
        assert.match(error.message, /Cannot reach Chrome DevTools/);
        assert.doesNotMatch(error.message, /synthetic-websocket-token/);
        return true;
      });
      assert.equal(session.isConnected(), false);
      assert.equal(session.currentPage(), null);
    }
    assert.deepEqual(upgrades, Array.from({ length: 2 }, () => ({
      url: "/cdp/devtools/browser/synthetic", authorization: "Bearer synthetic-websocket-token",
    })));
  } finally {
    await session.close();
    process.env = env;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("real Playwright discovery preserves gateway prefix, token rotation and shared failure admission", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-devtools-cdp-"));
  const env = { ...process.env };
  const requests: { url: string | undefined; authorization: string | undefined }[] = [];
  let malformedDiscovery = false;
  const server = createServer((req, res) => {
    if (malformedDiscovery) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ Browser: "Synthetic Chrome" }));
      return;
    }
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

    // A successful HTTP response is not a usable CDP connection when the
    // discovery document lacks a websocket URL. Never launch a replacement.
    malformedDiscovery = true;
    await assert.rejects(session.connect(), /Cannot reach Chrome DevTools/);
    assert.equal(session.isConnected(), false);
    malformedDiscovery = false;
    await assert.rejects(session.connect(), /Cannot reach Chrome DevTools/);
    assert.equal(requests.length, 3, "malformed discovery must not poison later explicit attaches");
  } finally {
    await session.close();
    process.env = env;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
