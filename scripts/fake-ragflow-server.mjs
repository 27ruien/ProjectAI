#!/usr/bin/env node

import http from "node:http";

if (process.env.NODE_ENV !== "test") throw new Error("Fake RAGFlow is test-only.");
const port = Number(process.env.FAKE_RAGFLOW_PORT || 3210);
const datasets = new Map();

function send(response, data, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ code: status < 400 ? 0 : 1, data, message: status < 400 ? "success" : "failed" }));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  const path = url.pathname.replace(/^\/api\/v1/u, "");
  if (path === "/datasets" && request.method === "GET") {
    const rows = [...datasets.values()].filter((item) => (!url.searchParams.get("id") || item.id === url.searchParams.get("id")) && (!url.searchParams.get("name") || item.name === url.searchParams.get("name")));
    return send(response, rows.map((item) => ({ id: item.id, name: item.name, document_count: item.documents.size })));
  }
  if (path === "/datasets" && request.method === "POST") {
    const input = JSON.parse((await body(request)).toString("utf8"));
    const id = `dataset-${crypto.randomUUID()}`;
    const item = { id, name: input.name, documents: new Map() };
    datasets.set(id, item);
    return send(response, { id, name: item.name, document_count: 0 });
  }
  if (path === "/datasets" && request.method === "DELETE") {
    const input = JSON.parse((await body(request)).toString("utf8"));
    for (const id of input.ids || []) datasets.delete(id);
    return send(response, true);
  }
  const documentMatch = path.match(/^\/datasets\/([^/]+)\/documents$/u);
  if (documentMatch) {
    const dataset = datasets.get(decodeURIComponent(documentMatch[1]));
    if (!dataset) return send(response, null, 404);
    if (request.method === "POST") {
      const raw = (await body(request)).toString("utf8");
      const name = raw.match(/filename="([^"]+)"/u)?.[1] || "test.txt";
      const id = `document-${crypto.randomUUID()}`;
      const canary = raw.includes("PROJECT_B_CANARY_57392") ? "PROJECT_B_CANARY_57392" : raw.includes("PROJECT_A_CANARY_92841") ? "PROJECT_A_CANARY_92841" : "FICTITIOUS_PROJECT_KNOWLEDGE";
      const document = {
        id,
        dataset_id: dataset.id,
        name,
        size: raw.length,
        run: "UNSTART",
        progress: 0,
        content: canary,
        failParseOnce: name.includes("parse-fail"),
      };
      dataset.documents.set(id, document);
      return send(response, [document]);
    }
    if (request.method === "GET") {
      const rows = [...dataset.documents.values()].filter((item) => !url.searchParams.get("id") || item.id === url.searchParams.get("id"));
      return send(response, { docs: rows, total: rows.length });
    }
    if (request.method === "DELETE") {
      const input = JSON.parse((await body(request)).toString("utf8"));
      for (const id of input.ids || []) dataset.documents.delete(id);
      return send(response, true);
    }
  }
  const parseMatch = path.match(/^\/datasets\/([^/]+)\/chunks$/u);
  if (parseMatch && request.method === "POST") {
    const dataset = datasets.get(decodeURIComponent(parseMatch[1]));
    if (!dataset) return send(response, null, 404);
    const input = JSON.parse((await body(request)).toString("utf8"));
    for (const id of input.document_ids || []) {
      const document = dataset.documents.get(id);
      if (document?.failParseOnce) {
        Object.assign(document, { run: "FAIL", progress: 0, failParseOnce: false });
      } else if (document) {
        Object.assign(document, { run: "DONE", progress: 1 });
      }
    }
    return send(response, true);
  }
  if (path === "/retrieval" && request.method === "POST") {
    const input = JSON.parse((await body(request)).toString("utf8"));
    const chunks = [];
    for (const datasetId of input.dataset_ids || []) {
      const dataset = datasets.get(datasetId);
      if (!dataset) continue;
      for (const document of dataset.documents.values()) {
        if (document.run !== "DONE") continue;
        chunks.push({ id: `chunk-${document.id}`, dataset_id: datasetId, document_id: document.id, document_keyword: document.name, content: document.content, similarity: 0.95 });
      }
    }
    return send(response, { chunks: chunks.slice(0, input.page_size || 10), total: chunks.length });
  }
  return send(response, null, 404);
});

server.listen(port, "127.0.0.1", () => process.stdout.write(`Fake RAGFlow listening on ${port}\n`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
