import assert from "node:assert/strict";

// The launcher restarts nginx synchronously, so Node may not process a pooled
// socket's close event before the next fetch. Close each verification request
// explicitly; never retry a registration or financial mutation.
export function createClient(base) {
  const cookies = new Map();
  let databaseId;
  return async function call(path, body) {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        Connection: "close",
        ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(databaseId ? { "X-Gentum-Database": databaseId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, 200, await response.clone().text());
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const index = pair.indexOf("=");
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const result = await response.json();
    if (path === "/auth/status") databaseId = result.databaseId;
    assert.equal(result.errors, undefined, JSON.stringify(result));
    return result;
  };
}
