import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { Follower } from "../dist/follower.js";
import { validateRpc } from "../dist/schema.js";

test("create_image validates the internal base64 RPC payload", () => {
  assert.equal(
    validateRpc("create_image", undefined, {
      imageBase64: "AA==",
      name: "Test image",
    }),
    null
  );
  assert.notEqual(
    validateRpc("create_image", undefined, { name: "Test image" }),
    null
  );
});

test("follower exposes validation errors returned by the leader", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "imageBase64 is required" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const follower = new Follower(`http://127.0.0.1:${address.port}`);
    await assert.rejects(
      follower.sendWithParams("create_image"),
      new Error("imageBase64 is required")
    );
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
