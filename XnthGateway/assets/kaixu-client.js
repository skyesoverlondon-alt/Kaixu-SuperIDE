/* Kaixu Client Utility (AUTO MODE + Client Error Reporter)
 * Drop-in browser helper for apps that talk to KaixuGateway13.
 *
 * Provides:
 *  - KaixuClient.autoChat(): auto-selects SSE stream vs background job + polling
 *  - KaixuClient.reportClientError(): sends structured client-side errors to gateway monitor
 *  - KaixuClient.installGlobalErrorHooks(): captures window.onerror + unhandledrejection
 */
(function(global){
  "use strict";

  const DEFAULTS = {
    // Heuristics: switch to background job when request is "big"
    maxTokensStream: 1200,
    messageCharsStream: 9000,
    // Streaming fallback: if no first delta arrives, fall back to job
    firstDeltaTimeoutMs: 25000,
    // Polling
    pollIntervalMs: 1200,
    maxPollMs: 14 * 60 * 1000 // 14 min safety (Netlify BG ~15 min)
  };

  function nowIso(){ try { return new Date().toISOString(); } catch { return null; } }

  function safeStr(v, max){
    if (v == null) return null;
    const s = String(v);
    return s.length <= max ? s : (s.slice(0, max) + "…");
  }

  function getApiBase(explicit){
    const fromArg = (explicit || "").trim();
    if (fromArg) return fromArg.replace(/\/+$/,"");
    try {
      const ls = (global.localStorage && global.localStorage.getItem("KAIXU_API_BASE")) || "";
      const v = (ls || "").trim();
      if (v) return v.replace(/\/+$/,"");
    } catch {}
    try { return global.location.origin; } catch { return ""; }
  }

  function urlJoin(base, path){
    const b = (base || "").replace(/\/+$/,"");
    const p = (path || "").startsWith("/") ? path : ("/"+path);
    return b + p;
  }

  function getOrCreateInstallId(explicit){
    const fromArg = (explicit || "").trim();
    if (fromArg) return fromArg.slice(0, 80);
    try {
      const existing = (global.localStorage && global.localStorage.getItem("KAIXU_INSTALL_ID")) || "";
      const v = (existing || "").trim();
      if (v) return v.slice(0, 80);
    } catch {}

    let id = "";
    try {
      if (global.crypto && typeof global.crypto.randomUUID === "function") {
        id = global.crypto.randomUUID();
      }
    } catch {}
    if (!id) {
      id = "inst_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
    }
    id = id.slice(0, 80);
    try { if (global.localStorage) global.localStorage.setItem("KAIXU_INSTALL_ID", id); } catch {}
    return id;
  }

  function headersWithAuth(h, apiKey, meta){
    const out = Object.assign({}, h || {});
    if (!out["content-type"] && !out["Content-Type"]) out["content-type"] = "application/json";
    if (apiKey && !out.authorization && !out.Authorization) out.authorization = "Bearer " + apiKey;

    const installId = getOrCreateInstallId(meta?.installId);
    if (installId && !out["x-kaixu-install-id"] && !out["X-Kaixu-Install-Id"]) {
      out["x-kaixu-install-id"] = installId;
    }
    if (meta?.app && !out["x-kaixu-app"] && !out["X-Kaixu-App"]) out["x-kaixu-app"] = safeStr(meta.app, 120);
    if (meta?.build && !out["x-kaixu-build"] && !out["X-Kaixu-Build"]) out["x-kaixu-build"] = safeStr(meta.build, 120);
    if (meta?.requestId && !out["x-kaixu-request-id"] && !out["X-Kaixu-Request-Id"]) out["x-kaixu-request-id"] = safeStr(meta.requestId, 120);

    return out;
  }

  function estimateMessageChars(messages){
    try {
      if (!Array.isArray(messages)) return 0;
      return messages.reduce((acc, m) => acc + String((m && m.content) || "").length, 0);
    } catch { return 0; }
  }

  function shouldUseJob(payload, opts){
    const o = Object.assign({}, DEFAULTS, (opts || {}));
    const maxTokens = Number.isFinite(payload?.max_tokens) ? Number(payload.max_tokens) : null;
    const msgChars = estimateMessageChars(payload?.messages);
    if (opts && opts.expectLargeOutput) return true;
    if (maxTokens != null && maxTokens > o.maxTokensStream) return true;
    if (msgChars > o.messageCharsStream) return true;
    return false;
  }

  function parseSSEChunk(buffer, onEvent){
    // Returns {rest} after consuming complete events.
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      let eventName = "message";
      let dataLines = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      const dataStr = dataLines.join("\n");
      let data = dataStr;
      try { data = JSON.parse(dataStr); } catch {}
      try { onEvent(eventName, data); } catch {}
    }
    return buffer;
  }

  async function streamChat({ apiBase, apiKey, payload, headers, onMeta, onDelta, onDone, onError, onEvent, opts }){
    const o = Object.assign({}, DEFAULTS, (opts || {}));
    const base = getApiBase(apiBase);
    const url = urlJoin(base, "/.netlify/functions/gateway-stream");
    const h = headersWithAuth(headers, apiKey, opts);
    h["x-kaixu-mode"] = "stream";

    const abort = new AbortController();
    let sawDelta = false;
    let firstDeltaTimer = null;

    const startFirstDeltaTimer = () => {
      try { if (firstDeltaTimer) clearTimeout(firstDeltaTimer); } catch {}
      firstDeltaTimer = setTimeout(() => {
        if (!sawDelta) abort.abort(new Error("No first delta within timeout"));
      }, o.firstDeltaTimeoutMs);
    };

    startFirstDeltaTimer();

    const res = await fetch(url, {
      method: "POST",
      headers: h,
      body: JSON.stringify(payload),
      signal: abort.signal
    });

    if (!res.ok) {
      const t = await res.text().catch(()=> "");
      const err = new Error(t || ("HTTP " + res.status));
      err.status = res.status;
      throw err;
    }
    if (!res.body) throw new Error("No stream body");

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      buf = parseSSEChunk(buf, (event, data) => {
        if (onEvent) onEvent(event, data);
        if (event === "meta") {
          try { if (onMeta) onMeta(data); } catch {}
        } else if (event === "delta") {
          sawDelta = true;
          try { if (firstDeltaTimer) { clearTimeout(firstDeltaTimer); firstDeltaTimer = null; } } catch {}
          try { if (onDelta) onDelta(data?.text ?? data); } catch {}
        } else if (event === "done") {
          try { if (onDone) onDone(data); } catch {}
        } else if (event === "error") {
          try { if (onError) onError(data); } catch {}
        }
      });
    }

    try { if (firstDeltaTimer) clearTimeout(firstDeltaTimer); } catch {}
    return { ok: true, mode: "stream" };
  }

  async function submitJob({ apiBase, apiKey, payload, headers, meta }){
    const base = getApiBase(apiBase);
    const url = urlJoin(base, "/.netlify/functions/gateway-job-submit");
    const h = headersWithAuth(headers, apiKey, meta);
    h["x-kaixu-mode"] = "job";
    const res = await fetch(url, { method:"POST", headers: h, body: JSON.stringify(payload) });
    const j = await res.json().catch(()=> ({}));
    if (!res.ok) {
      const err = new Error(j?.error || ("HTTP " + res.status));
      err.status = res.status;
      err.body = j;
      throw err;
    }
    return j;
  }

  async function pollJob({ apiBase, apiKey, job_id, headers, onStatus, opts }){
    const o = Object.assign({}, DEFAULTS, (opts || {}));
    const base = getApiBase(apiBase);

    const statusUrl = urlJoin(base, "/.netlify/functions/gateway-job-status?id=" + encodeURIComponent(job_id));
    const resultUrl = urlJoin(base, "/.netlify/functions/gateway-job-result?id=" + encodeURIComponent(job_id));

    const h = headersWithAuth(headers, apiKey, opts);
    h["x-kaixu-mode"] = "job";

    const started = Date.now();
    while (true) {
      if (Date.now() - started > o.maxPollMs) {
        const err = new Error("Job polling timed out");
        err.code = "JOB_POLL_TIMEOUT";
        throw err;
      }

      const sres = await fetch(statusUrl, { headers: h });
      const sj = await sres.json().catch(()=> ({}));
      if (onStatus) onStatus(sj);

      if (sj && (sj.status === "succeeded" || sj.status === "failed")) {
        const rres = await fetch(resultUrl, { headers: h });
        const rj = await rres.json().catch(()=> ({}));
        if (!rres.ok) {
          const err = new Error(rj?.error || ("HTTP " + rres.status));
          err.status = rres.status;
          err.body = rj;
          throw err;
        }
        if (sj.status === "failed") {
          const err = new Error(rj?.error || "Job failed");
          err.code = "JOB_FAILED";
          err.body = rj;
          throw err;
        }
        return rj;
      }

      await new Promise(r => setTimeout(r, o.pollIntervalMs));
    }
  }

  async function autoChat(args){
    const a = args || {};
    const payload = a.payload || {
      provider: a.provider,
      model: a.model,
      messages: a.messages,
      max_tokens: a.max_tokens,
      temperature: a.temperature
    };

    // Client metadata used for device-binding + monitoring (sent as headers)
    const meta = {
      installId: a.installId,
      app: a.app,
      build: a.build,
      requestId: a.requestId
    };

    // Force mode override if requested
    const forced = (a.mode || "").toLowerCase();
    if (forced === "job") {
      const j = await submitJob({ apiBase:a.apiBase, apiKey:a.apiKey, payload, headers:a.headers, meta });
      if (a.onMeta) a.onMeta({ mode:"job", job_id: j.job_id || j.id, submit: j });
      const r = await pollJob({ apiBase:a.apiBase, apiKey:a.apiKey, job_id: j.job_id || j.id, headers:a.headers, onStatus:a.onStatus, opts:Object.assign({}, a.opts || {}, meta) });
      if (a.onDone) a.onDone({ mode:"job", result: r });
      return { ok:true, mode:"job", result:r };
    }

    const useJob = shouldUseJob(payload, a);

    if (!useJob) {
      try {
        await streamChat({
          apiBase:a.apiBase, apiKey:a.apiKey, payload, headers:a.headers,
          onMeta:a.onMeta, onDelta:a.onDelta, onDone:a.onDone, onError:a.onError, onEvent:a.onEvent, opts:Object.assign({}, a.opts || {}, meta)
        });
        return { ok:true, mode:"stream" };
      } catch (e) {
        // Stream failed or no first delta -> fallback to job
        if (a.onStatus) a.onStatus({ ok:false, fallback:true, reason: e?.message || String(e) });
      }
    }

    payload._kaixu_meta = meta;
    const j = await submitJob({ apiBase:a.apiBase, apiKey:a.apiKey, payload, headers:a.headers, meta });
    if (a.onMeta) a.onMeta({ mode:"job", job_id: j.job_id || j.id, submit: j, fallback_from_stream: !useJob });
    const r = await pollJob({ apiBase:a.apiBase, apiKey:a.apiKey, job_id: j.job_id || j.id, headers:a.headers, onStatus:a.onStatus, opts:Object.assign({}, a.opts || {}, meta) });
    if (a.onDone) a.onDone({ mode:"job", result: r });
    return { ok:true, mode:"job", result:r };
  }

  async function reportClientError({ apiBase, app, build, token, error, context, client, tags }){
    const base = getApiBase(apiBase);
    const url = urlJoin(base, "/.netlify/functions/client-error-report");
    const h = { "content-type": "application/json" };
    if (app) h["x-kaixu-app"] = String(app);
    if (build) h["x-kaixu-build"] = String(build);
    if (token) h["x-kaixu-error-token"] = String(token);

    const payload = {
      client: Object.assign({
        url: (global.location && global.location.href) || null,
        user_agent: (global.navigator && global.navigator.userAgent) || null,
        language: (global.navigator && global.navigator.language) || null,
        platform: (global.navigator && global.navigator.platform) || null,
        viewport: (global.innerWidth && global.innerHeight) ? { w: global.innerWidth, h: global.innerHeight } : null,
        tags: tags || null,
        t: nowIso()
      }, client || {}),
      error: {
        name: safeStr(error?.name, 200),
        message: safeStr(error?.message || error, 8000),
        stack: safeStr(error?.stack, 20000)
      },
      context: context || null
    };

    try {
      const res = await fetch(url, { method:"POST", headers:h, body: JSON.stringify(payload) });
      return await res.json().catch(()=> ({}));
    } catch (e) {
      return { ok:false, error: e?.message || String(e) };
    }
  }

  function installGlobalErrorHooks({ apiBase, app, build, token, tags }){
    try {
      if (global.__KAIXU_ERR_HOOKS_INSTALLED) return;
      global.__KAIXU_ERR_HOOKS_INSTALLED = true;
    } catch {}

    const base = getApiBase(apiBase);

    function send(err, client){
      reportClientError({ apiBase: base, app, build, token, error: err, client, tags });
    }

    global.addEventListener("error", (ev) => {
      try {
        const e = ev.error || new Error(ev.message || "window.error");
        send(e, {
          source: ev.filename || null,
          lineno: Number.isFinite(ev.lineno) ? ev.lineno : null,
          colno: Number.isFinite(ev.colno) ? ev.colno : null
        });
      } catch {}
    });

    global.addEventListener("unhandledrejection", (ev) => {
      try {
        const reason = ev.reason;
        const e = reason instanceof Error ? reason : new Error(typeof reason === "string" ? reason : JSON.stringify(reason));
        send(e, { source: "unhandledrejection" });
      } catch {}
    });
  }

  global.KaixuClient = {
    autoChat,
    shouldUseJob,
    reportClientError,
    installGlobalErrorHooks,
    _internals: { getApiBase, urlJoin }
  };
})(typeof window !== "undefined" ? window : globalThis);
