import crypto from "crypto";
import WebSocket from "ws";

function mustEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === "") throw new Error(`Missing env: ${name}`);
  return v;
}

function optEnv(name, defVal) {
  const v = process.env[name];
  return (v === undefined || v === null || String(v).trim() === "") ? defVal : v;
}

const GREENHUB_WEBHOOK_URL = mustEnv("GREENHUB_WEBHOOK_URL");
const HMAC_SECRET = mustEnv("HMAC_SECRET");
const SITE_CODE = optEnv("SITE_CODE", "et_centre");

const BATCH_INTERVAL_SEC = Number(optEnv("BATCH_INTERVAL_SEC", "5"));
const MAX_BATCH_SIZE = Number(optEnv("MAX_BATCH_SIZE", "100"));
const LOG_LEVEL = optEnv("LOG_LEVEL", "info");

const allowlistRaw = optEnv("ENTITY_ALLOWLIST", "");

function globToRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = "^" + escaped.replace(/\*/g, ".*") + "$";
  return new RegExp(regexStr);
}

function compileAllowlist(rawAllowlist) {
  const exactMatches = new Set();
  const regexMatches = [];

  for (const item of rawAllowlist.split(",").map(s => s.trim()).filter(Boolean)) {
    if (item.includes("*")) {
      regexMatches.push(globToRegex(item));
    } else {
      exactMatches.add(item);
    }
  }

  return { exactMatches, regexMatches };
}

const { exactMatches, regexMatches } = compileAllowlist(allowlistRaw);

function log(level, msg, extra) {
  const levels = ["debug", "info", "warn", "error"];
  if (levels.indexOf(level) < levels.indexOf(LOG_LEVEL)) return;
  const base = { level, msg, t: new Date().toISOString() };
  console.log(JSON.stringify(extra ? { ...base, ...extra } : base));
}

function toWsUrl(haUrl) {
  // Accept http(s)://host:8123 -> ws(s)://host:8123/api/websocket
  const u = new URL(haUrl);
  const proto = (u.protocol === "https:") ? "wss:" : "ws:";
  return `${proto}//${u.host}/api/websocket`;
}

async function postJson(url, rawBody, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: rawBody,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

function hmac(raw) {
  const mac = crypto.createHmac("sha256", HMAC_SECRET).update(raw).digest("hex");
  return `sha256=${mac}`;
}

let buffer = [];
let lastFlush = Date.now();
let sending = false;

async function flush(reason = "interval") {
  if (sending) return;
  if (buffer.length === 0) return;

  sending = true;
  const events = buffer.splice(0, MAX_BATCH_SIZE);
  const sentAt = new Date().toISOString();

  const payload = {
    source: SITE_CODE,
    sent_at: sentAt,
    events,
  };

  const rawBody = JSON.stringify(payload);
  const headers = {
    "X-Greenhub-Timestamp": sentAt,
    "X-Greenhub-Signature": hmac(rawBody),
  };

  try {
    const r = await postJson(GREENHUB_WEBHOOK_URL, rawBody, headers);
    if (!r.ok) {
      // Put back to buffer (best-effort) to retry later
      buffer = events.concat(buffer);
      log("warn", "Webhook send failed", { reason, status: r.status, body: r.text?.slice(0, 200) });
    } else {
      log("info", "Batch sent", { reason, events_sent: events.length, status: r.status });
    }
  } catch (e) {
    buffer = events.concat(buffer);
    log("error", "Webhook send exception", { reason, error: String(e) });
  } finally {
    sending = false;
    lastFlush = Date.now();
  }
}

function pushEvent(ev) {
  buffer.push(ev);
  if (buffer.length >= MAX_BATCH_SIZE) flush("max_batch");
}

function shouldAccept(entityId) {
  if (exactMatches.size === 0 && regexMatches.length === 0) return true;
  if (exactMatches.has(entityId)) return true;

  for (const rx of regexMatches) {
    if (rx.test(entityId)) return true;
  }

  return false;
}

// ---- HA WebSocket via Supervisor (Add-on) ----
// Use ws://supervisor/core/api/websocket with SUPERVISOR_TOKEN
const HA_URL = mustEnv("HA_URL"); // ej: http://192.168.0.94:8123 o http://homeassistant.local:8123
const HA_WS_URL = toWsUrl(HA_URL);
const HA_TOKEN = mustEnv("HA_TOKEN"); // tu LLAT

let msgId = 1;

function send(ws, obj) {
  ws.send(JSON.stringify({ id: msgId++, ...obj }));
}

function start() {
  log("info", "Starting GreenHUB Bridge", {
    webhook: GREENHUB_WEBHOOK_URL,
    site: SITE_CODE,
    batch_interval_sec: BATCH_INTERVAL_SEC,
    max_batch: MAX_BATCH_SIZE,
    allowlist_count: exactMatches.size + regexMatches.length,
  });

  log("info", "Allowlist compiled", {
    exact_count: exactMatches.size,
    pattern_count: regexMatches.length,
  });

  const ws = new WebSocket(HA_WS_URL);

  ws.on("open", () => {
    log("info", "HA WS opened");
  });

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }

    // HA WS handshake
    if (msg.type === "auth_required") {
      ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN }));
      return;
    }
    if (msg.type === "auth_ok") {
      log("info", "HA WS auth ok");
      send(ws, { type: "subscribe_events", event_type: "state_changed" });
      return;
    }
    if (msg.type === "auth_invalid") {
      log("error", "HA WS auth invalid");
      ws.close();
      return;
    }

    // Event handling
    if (msg.type === "event" && msg.event?.event_type === "state_changed") {
      const entity_id = msg.event?.data?.entity_id;
      const ns = msg.event?.data?.new_state;
      if (!entity_id || !ns) return;
      if (!shouldAccept(entity_id)) return;

      const attributes = ns.attributes ?? {};
      const changed_at = ns.last_changed || ns.last_updated || new Date().toISOString();

      pushEvent({
        entity_id,
        state: String(ns.state ?? ""),
        unit: attributes.unit_of_measurement ?? null,
        attributes,
        changed_at,
      });
      return;
    }
  });

  ws.on("close", () => {
    log("warn", "HA WS closed, restarting in 5s");
    setTimeout(start, 5000);
  });

  ws.on("error", (err) => {
    log("error", "HA WS error", { error: String(err) });
  });

  // Flush loop
  setInterval(() => {
    const ageSec = (Date.now() - lastFlush) / 1000;
    if (buffer.length > 0 && ageSec >= BATCH_INTERVAL_SEC) flush("interval");
  }, 1000);
}

start();
