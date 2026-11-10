// WatchTogether — zero-dependency server.
// Serves the app, relays messages between people in a room (Server-Sent Events + POST),
// and remembers each room's current video so late joiners land in sync.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
// index.html can sit in a "public" folder or next to this file (handy when uploading through the GitHub website).
const PUBLIC = fs.existsSync(path.join(__dirname, "public", "index.html")) ? path.join(__dirname, "public") : __dirname;
const MAX_PEERS = Number(process.env.MAX_PEERS || 8);

// Connection helpers for calls.
// STUN finds a direct path. TURN relays the voice/video when networks block direct calls
// (common on mobile networks and in some countries). TURN over port 443 looks like normal secure web traffic.
const STUN = { urls: "stun:stun.l.google.com:19302" };

// 1) Your own TURN server, if you set TURN_URL, TURN_USERNAME, TURN_CREDENTIAL on your host.
// 2) Metered.ca account (free 20 GB/month): set METERED_DOMAIN (e.g. majlis.metered.live) and METERED_API_KEY.
// 3) Otherwise: Metered's free public Open Relay, with short-lived passwords made here.
let meteredIce = null;
async function refreshMetered() {
  if (!process.env.METERED_DOMAIN || !process.env.METERED_API_KEY) return;
  try {
    const r = await fetch(`https://${process.env.METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${encodeURIComponent(process.env.METERED_API_KEY)}`);
    if (r.ok) { const list = await r.json(); if (Array.isArray(list) && list.length) meteredIce = list; }
    else console.warn("Metered TURN credentials request failed:", r.status);
  } catch (e) { console.warn("Metered TURN credentials request failed:", e.message); }
}
refreshMetered();
setInterval(refreshMetered, 30 * 60 * 1000);

function openRelay() {
  const username = `${Math.floor(Date.now() / 1000) + 24 * 3600}:majlis`;
  const credential = crypto.createHmac("sha1", "openrelayprojectsecret").update(username).digest("base64");
  return {
    urls: [
      "turn:staticauth.openrelay.metered.ca:80",
      "turn:staticauth.openrelay.metered.ca:443?transport=tcp",
      "turns:staticauth.openrelay.metered.ca:443?transport=tcp",
    ],
    username, credential,
  };
}
function iceServers() {
  if (process.env.TURN_URL) {
    return [STUN, { urls: process.env.TURN_URL.split(",").map((u) => u.trim()), username: process.env.TURN_USERNAME || "", credential: process.env.TURN_CREDENTIAL || "" }];
  }
  if (meteredIce) return meteredIce;
  return [STUN, openRelay()];
}

/** rooms: code -> { peers: Map<id,{name,res,media}>, video: {...}|null, chat: [] } */
const rooms = new Map();

function room(code) {
  if (!rooms.has(code)) rooms.set(code, { peers: new Map(), video: null, chat: [] });
  return rooms.get(code);
}
function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function broadcast(r, event, data, exceptId) {
  for (const [id, p] of r.peers) if (id !== exceptId) send(p.res, event, data);
}
function peerList(r) {
  return [...r.peers].map(([id, p]) => ({ id, name: p.name, media: p.media }));
}
const cleanCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
const cleanName = (s) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 30) || "Guest";

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("too large")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon" };

function serveStatic(req, res, pathname) {
  let file = pathname === "/" || pathname.startsWith("/r/") ? "/index.html" : pathname;
  const full = path.normalize(path.join(PUBLIC, file));
  if (!full.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found"); return; }
    const type = TYPES[path.extname(full)] || "application/octet-stream";
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start >= st.size || start > end) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }).end(); return; }
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
      fs.createReadStream(full, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" });
    fs.createReadStream(full).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  // Live stream of room events for one person.
  if (p === "/events" && req.method === "GET") {
    const code = cleanCode(url.searchParams.get("room"));
    const id = String(url.searchParams.get("id") || "").slice(0, 40);
    if (!code || !id) { res.writeHead(400).end("room and id required"); return; }
    const r = room(code);
    if (!r.peers.has(id) && r.peers.size >= MAX_PEERS) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      send(res, "full", { max: MAX_PEERS });
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 2000\n\n");
    const old = r.peers.get(id);
    if (old) { try { old.res.end(); } catch {} }
    const name = cleanName(url.searchParams.get("name"));
    const peer = { name, res, media: { mic: false, cam: false, screen: false } };
    const others = peerList(r);
    r.peers.set(id, peer);
    send(res, "welcome", { fresh: !old, you: id, peers: others, video: r.video, chat: r.chat.slice(-50), serverTime: Date.now(), ice: iceServers() });
    if (!old) broadcast(r, "join", { id, name, media: peer.media }, id);

    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => {
      clearInterval(ping);
      if (r.peers.get(id) === peer) {
        r.peers.delete(id);
        broadcast(r, "leave", { id });
        if (r.peers.size === 0) setTimeout(() => { if (r.peers.size === 0) rooms.delete(code); }, 10 * 60 * 1000);
      }
    });
    return;
  }

  // Send a message to the room (or to one person).
  if (p === "/send" && req.method === "POST") {
    let msg;
    try { msg = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
    const r = rooms.get(cleanCode(msg.room));
    const from = String(msg.from || "");
    if (!r || !r.peers.has(from)) { res.writeHead(404).end(); return; }
    const me = r.peers.get(from);
    const out = { from, type: msg.type, data: msg.data, serverTime: Date.now() };

    if (msg.type === "video" && msg.data && typeof msg.data === "object") {
      r.video = { ...msg.data, by: me.name, serverTime: out.serverTime };
      out.data = r.video;
    } else if (msg.type === "chat") {
      const text = String(msg.data && msg.data.text || "").slice(0, 500);
      if (!text.trim()) { res.writeHead(204).end(); return; }
      out.data = { text, name: me.name, at: out.serverTime };
      r.chat.push(out.data);
      if (r.chat.length > 200) r.chat.shift();
    } else if (msg.type === "media" && msg.data) {
      me.media = { mic: !!msg.data.mic, cam: !!msg.data.cam, screen: !!msg.data.screen };
      out.data = me.media;
    } else if (msg.type === "beat") {
      res.writeHead(204).end(); return;
    } else if (msg.type !== "signal" && msg.type !== "react") {
      res.writeHead(400).end(); return;
    }

    if (msg.to) {
      const target = r.peers.get(String(msg.to));
      if (target) send(target.res, "msg", out);
    } else {
      broadcast(r, "msg", out, msg.type === "chat" || msg.type === "react" ? null : from);
    }
    res.writeHead(204).end();
    return;
  }

  if (p === "/health") { res.writeHead(200, { "Content-Type": "text/plain" }).end("ok"); return; }
  if (p === "/new") {
    const code = crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
    res.writeHead(302, { Location: "/r/" + code }).end();
    return;
  }
  if (req.method === "GET") return serveStatic(req, res, p);
  res.writeHead(405).end();
});

server.listen(PORT, () => console.log(`WatchTogether running on http://localhost:${PORT}`));
