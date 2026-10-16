import assert from "node:assert/strict";

// The launcher restarts nginx synchronously, so Node may not process a pooled
// socket's close event before the next fetch. Close each verification request
// explicitly; never retry a registration or financial mutation.
export function createClient(base) {
  let cookie;
  return async function call(path, body) {
    const response = await fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        Connection: "close",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200, await response.clone().text());
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    const result = await response.json();
    assert.equal(result.errors, undefined, JSON.stringify(result));
    return result;
  };
}
