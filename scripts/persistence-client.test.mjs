import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { once } from "node:events";
import { createClient } from "./persistence-client.mjs";

test("persistence requests use fresh connections across server restart and retain session cookie", async () => {
  let requests = 0;
  const sockets = new Set();
  const server = createServer((request, response) => {
    requests++;
    sockets.add(request.socket);
    assert.equal(request.headers.connection, "close");
    if (requests > 1)
      assert.equal(request.headers.cookie, "fixture=local-session");
    response.setHeader("Content-Type", "application/json");
    response.setHeader(
      "Set-Cookie",
      "fixture=local-session; HttpOnly; SameSite=Strict",
    );
    response.end(JSON.stringify({ request: requests }));
  });
  const listen = async (port) => {
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
  };
  const close = async () => {
    server.close();
    await once(server, "close");
  };
  await listen(0);
  const port = server.address().port;
  const call = createClient(`http://127.0.0.1:${port}`);
  try {
    assert.deepEqual(await call("/before", {}), { request: 1 });
    assert.deepEqual(await call("/before-again", {}), { request: 2 });
    await close();
    await listen(port);
    assert.deepEqual(await call("/after-restart", {}), { request: 3 });
    assert.equal(sockets.size, 3);
    assert.equal(requests, 3);
  } finally {
    if (server.listening) await close();
  }
});

test("failed financial requests are surfaced once without retry", async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(503);
    response.end("fixture unavailable");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const call = createClient(`http://127.0.0.1:${server.address().port}`);
    await assert.rejects(
      call("/graphql", { query: "mutation" }),
      /fixture unavailable/,
    );
    assert.equal(requests, 1);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("database discovery retains both selection and authentication cookies and binds later requests", async () => {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/auth/status") {
      response.setHeader("Set-Cookie", ["gentum_database_session=selection; HttpOnly", "gentum_session=auth; HttpOnly"]);
      response.end(JSON.stringify({ databaseId: "database-a" }));
    } else {
      assert.equal(request.headers["x-gentum-database"], "database-a");
      assert.equal(request.headers.cookie, "gentum_database_session=selection; gentum_session=auth");
      response.end("{}");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const call = createClient(`http://127.0.0.1:${server.address().port}`);
    await call("/auth/status");
    await call("/graphql", { query: "{accounts{id}}" });
  } finally {
    server.close();
    await once(server, "close");
  }
});
