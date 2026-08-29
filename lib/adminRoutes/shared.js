const fs = require("fs");
const path = require("path");

function sendJson(res, status, body) {
    const json = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(json),
        "Cache-Control": "no-store",
    });
    res.end(json);
}

// Reads a request body up to `maxBytes`. IMPORTANT: on an oversized
// payload this used to call req.destroy(), which kills the underlying
// socket outright — since req/res share that socket, this made it
// IMPOSSIBLE to ever send the "Payload too large" error back to the
// client. The upload would just hang, then the connection would reset
// with no readable error — silently vanishing from the UI with no
// indication of what went wrong (this is exactly what was happening to
// mp3 uploads over the old 20MB cap).
//
// Now: once the limit is exceeded, we stop buffering and simply drain/
// ignore the rest of the incoming data (never destroying the socket),
// so the response below can still be written normally. The rejected
// error carries `.code = "PAYLOAD_TOO_LARGE"` so callers can respond
// with a proper 413 and a clear, size-specific message instead of a
// generic 500.
function readBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let rejected = false;

        req.on("data", (chunk) => {
            if (rejected) return; // already over limit — just drain, don't buffer

            total += chunk.length;
            if (total > maxBytes) {
                rejected = true;
                const err = new Error("Payload too large");
                err.code = "PAYLOAD_TOO_LARGE";
                reject(err);
                return;
            }
            chunks.push(chunk);
        });

        req.on("end", () => {
            if (!rejected) resolve(Buffer.concat(chunks));
        });

        req.on("error", (e) => {
            if (!rejected) {
                rejected = true;
                reject(e);
            }
        });
    });
}

async function readJsonBody(req) {
    const buf = await readBody(req, 5 * 1024 * 1024);
    return JSON.parse(buf.toString("utf-8"));
}

// Atomic write for arbitrary JSON files edited through the generic
// /api/file endpoint below. Writes to a temp file in the SAME directory,
// then rename()s it into place — rename is atomic at the filesystem level,
// so there is never a window where the destination file is truncated or
// half-written, regardless of what else reads/writes it concurrently
// (this endpoint is what the Admin panel's "target"-based elements use to
// edit config/master.json directly, so this is a likely source of any
// intermittent trailing-garbage/corruption seen in that file).
function writeJsonFileAtomic(filePath, data) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const json    = JSON.stringify(data, null, 4);
    const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
    fs.writeFileSync(tmpPath, json);
    fs.renameSync(tmpPath, filePath);
}

// Atomic write for arbitrary RAW TEXT files (e.g. a blog's content.md).
// Same rename()-based safety as writeJsonFileAtomic above, just without
// the JSON.stringify step.
function writeTextFileAtomic(filePath, text) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
    fs.writeFileSync(tmpPath, text, "utf-8");
    fs.renameSync(tmpPath, filePath);
}

module.exports = {
    sendJson,
    readBody,
    readJsonBody,
    writeJsonFileAtomic,
    writeTextFileAtomic,
};
