import fs from "node:fs";

async function writeSpec({ app, path }) {
  const response = await app.fetch(new Request("http://localhost/openapi.json"));
  if (!response.ok) {
    throw new Error(`Failed to generate ${path}: HTTP ${response.status}`);
  }
  fs.writeFileSync(path, `${JSON.stringify(await response.json(), null, 4)}\n`);
}

const [{ default: publicApp }, { default: privateApp }] = await Promise.all([
  import("../packages/api/dist/openapi.js"),
  import("../packages/api/dist/openapi-private.js"),
]);

await writeSpec({ app: publicApp, path: "packages/docs/openapi.json" });
await writeSpec({ app: privateApp, path: "packages/api/openapi.private.json" });
