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

function writeJsonFileAtomic(filePath, data) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const json    = JSON.stringify(data, null, 4);
    const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
    fs.writeFileSync(tmpPath, json);
    fs.renameSync(tmpPath, filePath);
}

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
