const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data.json");
const MAX_BODY_BYTES = 24 * 1024 * 1024;
const PORT = Number(process.env.PORT) || 4173;
const STATIC_FILES = {
  "/": "AccrediAI.html",
  "/AccrediAI.html": "AccrediAI.html",
  "/app.js": "app.js",
  "/role-features.js": "role-features.js",
  "/svg.js": "svg.js",
  "/styles.css": "styles.css",
  "/google-fonts.css": "google-fonts.css",
  "/assets/accrediai-mark.svg": "assets/accrediai-mark.svg"
};
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function sendJSON(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

async function getProjectData(response) {
  try {
    const contents = await fs.readFile(DATA_FILE, "utf8");
    sendJSON(response, 200, JSON.parse(contents));
  } catch (error) {
    console.error("Could not read data.json", error);
    sendJSON(response, 500, { error: "Could not read the project JSON file." });
  }
}

function normalizeCopilotText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function answerCopilot(request, response) {
  let body = "";
  let bodyBytes = 0;
  let tooLarge = false;
  request.setEncoding("utf8");
  request.on("data", function (chunk) {
    bodyBytes += Buffer.byteLength(chunk, "utf8");
    if (bodyBytes > 16384) tooLarge = true;
    else body += chunk;
  });
  request.on("end", async function () {
    if (tooLarge) return sendJSON(response, 413, { error: "The Copilot question is too long." });
    try {
      const payload = JSON.parse(body);
      if (!payload || typeof payload !== "object") return sendJSON(response, 400, { error: "Enter a Copilot question." });
      const question = typeof payload.question === "string" ? payload.question.slice(0, 500) : "";
      const query = normalizeCopilotText(question);
      if (!query) return sendJSON(response, 400, { error: "Enter a Copilot question." });

      const entries = JSON.parse(await fs.readFile(path.join(ROOT, "copilot-knowledge.json"), "utf8"));
      if (!Array.isArray(entries)) throw new Error("Invalid Copilot question data.");
      const exact = entries.find(function (entry) { return normalizeCopilotText(entry.question) === query; });
      if (exact) return sendJSON(response, 200, { answer: exact.answer });

      const ignored = new Set(["what", "which", "where", "when", "how", "can", "does", "do", "is", "are", "the", "a", "an", "my", "our", "i", "we", "me", "to", "for", "in", "on", "of", "and", "please"]);
      const terms = query.split(/\s+/).filter(function (term) { return term.length > 1 && !ignored.has(term); });
      let bestAnswer = null;
      let bestScore = 0;
      if (terms.length) {
        entries.forEach(function (entry) {
          const keywords = Array.isArray(entry.keywords) ? entry.keywords.join(" ") : "";
          const candidate = normalizeCopilotText(entry.question + " " + keywords);
          const matched = terms.filter(function (term) { return candidate.includes(term); }).length;
          const score = matched / terms.length;
          if (score > bestScore) {
            bestScore = score;
            bestAnswer = entry.answer;
          }
        });
      }
      sendJSON(response, 200, { answer: bestScore >= 0.5 ? bestAnswer : null });
    } catch (error) {
      console.error("Could not answer the Copilot question", error);
      sendJSON(response, 500, { error: "Could not load a Copilot answer." });
    }
  });
}

function validProjectData(data) {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.criteria) ||
      !Array.isArray(data.evidence) || !Array.isArray(data.queue)) return false;
  return data.evidence.every(function (entry) {
    if (!entry || !entry.image) return true;
    const image = entry.image;
    const mime = image.mimeType || image.type || "";
    const bytes = image.base64 || image.bytecode || image.bytes || "";
    return /^image\/(png|jpeg|webp|gif)$/.test(mime) && /^[A-Za-z0-9+\/]+=*$/.test(bytes);
  });
}

function saveProjectData(request, response) {
  let body = "";
  let bodyBytes = 0;
  let tooLarge = false;
  request.setEncoding("utf8");
  request.on("data", function (chunk) {
    bodyBytes += Buffer.byteLength(chunk, "utf8");
    if (bodyBytes > MAX_BODY_BYTES) tooLarge = true;
    else body += chunk;
  });
  request.on("end", async function () {
    if (tooLarge) return sendJSON(response, 413, { error: "The JSON upload is too large." });
    try {
      const data = JSON.parse(body);
      if (!validProjectData(data)) return sendJSON(response, 400, { error: "Unsupported AccrediAI JSON data." });
      data.updatedAt = new Date().toISOString();
      const temporaryFile = DATA_FILE + "." + process.pid + ".tmp";
      await fs.writeFile(temporaryFile, JSON.stringify(data, null, 2) + "\n", "utf8");
      await fs.rename(temporaryFile, DATA_FILE);
      sendJSON(response, 200, { saved: true, updatedAt: data.updatedAt });
    } catch (error) {
      console.error("Could not save data.json", error);
      sendJSON(response, 400, { error: "Could not save the project JSON data." });
    }
  });
}

async function serveStatic(pathname, response) {
  const relativeFile = STATIC_FILES[pathname];
  if (!relativeFile) return sendJSON(response, 404, { error: "Not found." });
  try {
    const filePath = path.join(ROOT, relativeFile);
    const contents = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(contents);
  } catch (error) {
    console.error("Could not serve " + relativeFile, error);
    sendJSON(response, 404, { error: "File not found." });
  }
}

const server = http.createServer(function (request, response) {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (request.method === "GET" && pathname === "/api/data") return getProjectData(response);
  if (request.method === "POST" && pathname === "/api/data") return saveProjectData(request, response);
  if (request.method === "POST" && pathname === "/api/copilot") return answerCopilot(request, response);
  if (request.method === "GET" || request.method === "HEAD") return serveStatic(pathname, response);
  sendJSON(response, 405, { error: "Method not allowed." });
});

server.listen(PORT, "127.0.0.1", function () {
  console.log("AccrediAI is available at http://127.0.0.1:" + PORT);
  console.log("Evidence records and image bytes are saved to " + DATA_FILE);
});
