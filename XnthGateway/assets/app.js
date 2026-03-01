(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ------------------------------
  // Storage
  // ------------------------------
  const baseStore = {
    get apiBase() { return (localStorage.getItem("KAIXU_API_BASE") || "").trim(); },
    set apiBase(v) { localStorage.setItem("KAIXU_API_BASE", (v || "").trim()); }
  };

  const store = {
    // Admin token: session-only
    get adminToken() { return (sessionStorage.getItem("KAIXU_ADMIN_TOKEN") || "").trim(); },
    set adminToken(v) {
      const t = (v || "").trim();
      if (t) sessionStorage.setItem("KAIXU_ADMIN_TOKEN", t);
      else sessionStorage.removeItem("KAIXU_ADMIN_TOKEN");
    },

    // Customer selection: ok to persist
    get selectedCustomerId() { return (localStorage.getItem("KAIXU_SELECTED_CUSTOMER") || "").trim(); },
    set selectedCustomerId(v) { localStorage.setItem("KAIXU_SELECTED_CUSTOMER", (v || "").trim()); }
  };


  // Clean up legacy admin password storage if it exists
  try { localStorage.removeItem("KAIXU_ADMIN_PASSWORD"); } catch {}
  // Hard-coded priced models to nudge admins away from UNPRICED_MODEL.
  // Keep aligned to pricing/pricing.json.
  const PRICED = {
    openai: new Set(["gpt-4o", "gpt-4o-mini"]),
    anthropic: new Set(["claude-3-5-sonnet-20241022", "claude-opus-4-6"]),
    gemini: new Set(["gemini-2.5-flash"])
  };

  // ------------------------------
  // Helpers
  // ------------------------------
  function normalizeBase(b) {
    b = (b || "").trim();
    if (!b) return "";
    return b.replace(/\/+$/, "");
  }

  function apiUrl(path) {
    const base = normalizeBase(baseStore.apiBase);
    if (!base) return path;
    if (/^https?:\/\//i.test(path)) return path;
    return base + path;
  }

  const toast = $("#toast");
  function showToast(msg, ok = true) {
    if (!toast) return;
    toast.textContent = msg;
    toast.className = "toast " + (ok ? "good" : "bad");
    toast.style.display = "block";
    setTimeout(() => (toast.style.display = "none"), 4500);
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>'"]/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      "\"": "&quot;"
    }[c]));
  }
  function escapeAttr(str) {
    // attribute-safe escape (quotes included)
    return escapeHtml(str).replace(/"/g, "&quot;");
  }
  function formatBytes(n) {
    const v = Number(n || 0);
    if (!Number.isFinite(v) || v <= 0) return "0 B";
    const units = ["B","KB","MB","GB","TB"];
    let x = v;
    let i = 0;
    while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
    const digits = i === 0 ? 0 : (i === 1 ? 1 : 2);
    return x.toFixed(digits) + " " + units[i];
  }



  function money(cents) {
    const n = Math.round(Number(cents || 0));
    return "$" + (n / 100).toFixed(2);
  }

  function monthKeyUTC() {
    return new Date().toISOString().slice(0, 7);
  }

  async function copyText(s) {
    const text = String(s || "");
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand("copy"); } catch { }
      ta.remove();
      return true;
    }
  }

  function setSelectedCustomer(cid) {
    const id = cid ? String(cid) : "";
    store.selectedCustomerId = id;

    const ids = ["#kCustomerId", "#uCustomerId", "#billCustomerId", "#devCustomerId", "#expCustomerId", "#pushCustomerId"];
    ids.forEach((sel) => { const el = $(sel); if (el) el.value = id; });

    // Exports default month
    const expMonth = $("#expMonth");
    if (expMonth && !expMonth.value) expMonth.value = monthKeyUTC();
  }

  function warnIfUnpriced(allowedProviders, allowedModelsObj) {
    try {
      const warnings = [];
      const provs = Array.isArray(allowedProviders) ? allowedProviders : null;

      // If allowed_models is an object like {"openai":["gpt-4o-mini"],"anthropic":["*"]}
      if (allowedModelsObj && typeof allowedModelsObj === "object") {
        for (const [provider, models] of Object.entries(allowedModelsObj)) {
          if (!PRICED[provider]) {
            warnings.push(`Provider "${provider}" is not priced.`);
            continue;
          }
// ------------------------------
// Priced model allowlist picker (UI helper)
// Writes into the existing allowed_models JSON textarea so backend contracts remain unchanged.
// ------------------------------
function mountPricedModelPicker(textareaSel, providersInputSel) {
  const ta = $(textareaSel);
  if (!ta) return;

  const existing = document.getElementById(`picker-${ta.id}`);
  if (existing) return;

  const wrap = document.createElement("div");
  wrap.id = `picker-${ta.id}`;
  wrap.style.marginTop = "8px";
  wrap.style.padding = "10px";
  wrap.style.border = "1px solid rgba(255,255,255,0.10)";
  wrap.style.borderRadius = "12px";
  wrap.style.background = "rgba(0,0,0,0.20)";

  const title = document.createElement("div");
  title.className = "muted small";
  title.style.marginBottom = "8px";
  title.textContent = "Allowlist builder (priced models). This edits the JSON box above — you can still edit by hand.";
  wrap.appendChild(title);

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.flexWrap = "wrap";
  row.style.gap = "8px";
  row.style.alignItems = "center";

  const providerSel = document.createElement("select");
  providerSel.style.padding = "8px";
  providerSel.style.borderRadius = "10px";
  providerSel.style.border = "1px solid rgba(255,255,255,0.14)";
  providerSel.style.background = "rgba(0,0,0,0.25)";
  providerSel.style.color = "inherit";

  const providers = Object.keys(PRICED).sort();
  for (const p of providers) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    providerSel.appendChild(opt);
  }

  const includeProvider = document.createElement("label");
  includeProvider.style.display = "flex";
  includeProvider.style.alignItems = "center";
  includeProvider.style.gap = "6px";
  includeProvider.style.marginLeft = "4px";
  const includeCb = document.createElement("input");
  includeCb.type = "checkbox";
  includeCb.checked = true;
  includeProvider.appendChild(includeCb);
  const includeTxt = document.createElement("span");
  includeTxt.className = "muted small";
  includeTxt.textContent = "Also add provider to allowed_providers";
  includeProvider.appendChild(includeTxt);

  const btnApply = document.createElement("button");
  btnApply.type = "button";
  btnApply.className = "btn";
  btnApply.textContent = "Apply selection";

  const btnClearProv = document.createElement("button");
  btnClearProv.type = "button";
  btnClearProv.className = "btn";
  btnClearProv.textContent = "Remove provider from JSON";

  const btnAll = document.createElement("button");
  btnAll.type = "button";
  btnAll.className = "btn";
  btnAll.textContent = "Set all priced defaults";

  row.appendChild(providerSel);
  row.appendChild(includeProvider);
  row.appendChild(btnApply);
  row.appendChild(btnClearProv);
  row.appendChild(btnAll);
  wrap.appendChild(row);

  const modelsBox = document.createElement("div");
  modelsBox.style.marginTop = "10px";
  modelsBox.style.display = "flex";
  modelsBox.style.flexWrap = "wrap";
  modelsBox.style.gap = "10px";
  wrap.appendChild(modelsBox);

  function safeParseJSON(s) {
    const raw = (s || "").trim();
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return null; }
  }

  function writeJSON(obj) {
    ta.value = Object.keys(obj || {}).length ? JSON.stringify(obj, null, 2) : "";
  }

  function getProvidersInput() {
    return providersInputSel ? $(providersInputSel) : null;
  }

  function mergeProviderToAllowedProviders(p) {
    const inp = getProvidersInput();
    if (!inp) return;
    const cur = (inp.value || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!cur.includes(p)) cur.push(p);
    inp.value = cur.join(",");
  }

  function renderModels() {
    modelsBox.innerHTML = "";
    const p = providerSel.value;
    const items = ["*"].concat(Array.from(PRICED[p] || []).sort());

    for (const model of items) {
      const lab = document.createElement("label");
      lab.style.display = "flex";
      lab.style.alignItems = "center";
      lab.style.gap = "6px";
      lab.style.padding = "6px 10px";
      lab.style.border = "1px solid rgba(255,255,255,0.10)";
      lab.style.borderRadius = "999px";
      lab.style.background = "rgba(0,0,0,0.18)";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = model;

      // If wildcard is checked, uncheck specific models (and vice versa)
      cb.addEventListener("change", () => {
        if (cb.value === "*" && cb.checked) {
          modelsBox.querySelectorAll("input[type=checkbox]").forEach((x) => {
            if (x !== cb) x.checked = false;
          });
        } else if (cb.value !== "*" && cb.checked) {
          const star = modelsBox.querySelector('input[type=checkbox][value="*"]');
          if (star) star.checked = false;
        }
      });

      const t = document.createElement("span");
      t.className = "small";
      t.textContent = model;

      lab.appendChild(cb);
      lab.appendChild(t);
      modelsBox.appendChild(lab);
    }

    // Try to pre-check based on current textarea JSON
    const parsed = safeParseJSON(ta.value);
    if (parsed && parsed[p] && Array.isArray(parsed[p])) {
      const set = new Set(parsed[p]);
      modelsBox.querySelectorAll("input[type=checkbox]").forEach((x) => {
        if (set.has(x.value)) x.checked = true;
      });
    }
  }

  providerSel.addEventListener("change", renderModels);

  btnApply.addEventListener("click", () => {
    const p = providerSel.value;
    const parsed = safeParseJSON(ta.value);
    if (parsed === null) return showToast("Allowed models JSON is invalid — fix it or clear it first.", false);

    const selected = Array.from(modelsBox.querySelectorAll("input[type=checkbox]:checked")).map((x) => x.value);
    if (!selected.length) return showToast("Select at least one model (or '*').", false);

    const next = parsed || {};
    // Normalize: if "*" selected, set only ["*"]
    next[p] = selected.includes("*") ? ["*"] : selected.sort();

    writeJSON(next);

    if (includeCb.checked) mergeProviderToAllowedProviders(p);

    // Surface warnings early
    const allowedProviders = getProvidersInput()?.value
      ? getProvidersInput().value.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
    warnIfUnpriced(allowedProviders, next);

    showToast("Allowlist JSON updated.", true);
  });

  btnClearProv.addEventListener("click", () => {
    const p = providerSel.value;
    const parsed = safeParseJSON(ta.value);
    if (parsed === null) return showToast("Allowed models JSON is invalid — fix it or clear it first.", false);

    const next = parsed || {};
    delete next[p];
    writeJSON(next);
    renderModels();
    showToast(`Removed ${p} from JSON.`, true);
  });

  btnAll.addEventListener("click", () => {
    const next = {};
    for (const p of providers) next[p] = Array.from(PRICED[p]).sort();
    writeJSON(next);

    if (includeCb.checked) {
      const inp = getProvidersInput();
      if (inp) inp.value = providers.join(",");
    }

    showToast("Set all priced models as defaults.", true);
    renderModels();
  });

  // Mount after textarea
  ta.insertAdjacentElement("afterend", wrap);

  // Initial render
  renderModels();
}

          if (Array.isArray(models)) {
            for (const m of models) {
              if (m === "*" || m === "all") continue;
              if (!PRICED[provider].has(String(m))) warnings.push(`Unpriced model "${provider}:${m}"`);
            }
          }
        }
      } else if (provs) {
        // If they only set providers, warn if provider isn't priced at all (rare)
        for (const p of provs) {
          if (!PRICED[p]) warnings.push(`Provider "${p}" is not priced.`);
        }
      }

      if (warnings.length) showToast("Pricing warning: " + warnings.join(" · "), false);
    } catch { }
  }

  // ------------------------------
  // Auth + API wrappers
  // ------------------------------
  function setAuthUI(isAuthed) {
    const loginView = $("#loginView");
    const appView = $("#appView");
    const logoutBtn = $("#logoutBtn");
    if (loginView) loginView.style.display = isAuthed ? "none" : "block";
    if (appView) appView.style.display = isAuthed ? "block" : "none";
    if (logoutBtn) logoutBtn.style.display = isAuthed ? "inline-flex" : "none";
  }

  function clearAuth() {
    store.adminToken = "";
    setAuthUI(false);
  }

  async function adminLoginWithPassword(password) {
    const res = await fetch(apiUrl("/.netlify/functions/admin-login"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error || ("HTTP " + res.status);
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    if (!data?.token) throw new Error("Login failed: missing token");
    return data.token;
  }

  async function apiAdmin(path, { method = "GET", body = null, headers = {} } = {}) {
    const token = store.adminToken;
    if (!token) {
      const err = new Error("Not logged in");
      err.status = 401;
      throw err;
    }

    const h = {
      ...headers,
      "authorization": `Bearer ${token}`
    };
    if (body !== null) h["content-type"] = "application/json";

    const res = await fetch(apiUrl(path), { method, headers: h, body: body !== null ? JSON.stringify(body) : undefined });

    if (res.status === 401) {
      clearAuth();
      const data401 = await res.json().catch(() => ({}));
      throw new Error(data401?.error || "Unauthorized (login again)");
    }

    // Exports return CSV, so only parse JSON when content-type says so
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data?.error || ("HTTP " + res.status));
        err.status = res.status;
        err.detail = data;
        throw err;
      }
      return data;
    }

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(t || ("HTTP " + res.status));
    }
    return res;
  }

  async function downloadAdmin(path, filename) {
    const token = store.adminToken;
    if (!token) throw new Error("Not logged in");

    const res = await fetch(apiUrl(path), {
      method: "GET",
      headers: { "authorization": `Bearer ${token}` }
    });

    if (res.status === 401) {
      clearAuth();
      throw new Error("Unauthorized (login again)");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || ("HTTP " + res.status));
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "export.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ------------------------------
  // Tabs
  // ------------------------------
  function switchTab(name) {
    $$(".tab").forEach((b) => b.classList.remove("active"));
    const btn = $(`.tab[data-tab="${name}"]`);
    if (btn) btn.classList.add("active");
    $$(".tabpanel").forEach((p) => (p.style.display = "none"));
    const panel = $("#tab-" + name);
    if (panel) panel.style.display = "block";
  }
  $$(".tab").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

  // ------------------------------
  // Customers
  // ------------------------------
  let customersCache = [];

  async function loadCustomers() {
    const data = await apiAdmin("/.netlify/functions/admin-customers");
    customersCache = data.customers || [];

    const tbody = $("#customersTable tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    for (const c of customersCache) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${c.id}</td>
        <td>${escapeHtml(c.email)}</td>
        <td>${escapeHtml(c.plan_name)}</td>
        <td>${money(c.monthly_cap_cents)}</td>
        <td>${c.is_active ? "Yes" : "No"}</td>
        <td>${Number.isFinite(+c.active_keys) ? (+c.active_keys) : ""}</td>
        <td>${c.has_netlify_token ? "Yes" : "No"}</td>
        <td>${c.created_at ? new Date(c.created_at).toLocaleString() : ""}</td>
      `;
      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => {
        setSelectedCustomer(c.id);
        showToast(`Selected customer #${c.id} — loading keys…`, true);
        switchTab("keys");
        loadKeys().catch((e) => showToast(e.message, false));
      });
      tbody.appendChild(tr);
    }
  }

  async function setNetlifyTokenForSelectedCustomer() {
    const cid = ($("#kCustomerId")?.value || store.selectedCustomerId || "").trim();
    if (!cid) throw new Error("Select a customer first (click a row in Customers).");
    const token = prompt(`Paste Netlify Personal Access Token for customer #${cid}:`);
    if (!token) return;
    await apiAdmin("/.netlify/functions/admin-netlify-token", { method: "POST", body: { customer_id: cid, token } });
    showToast("Netlify token saved for customer.", true);
    await loadCustomers();
  }

  async function clearNetlifyTokenForSelectedCustomer() {
    const cid = ($("#kCustomerId")?.value || store.selectedCustomerId || "").trim();
    if (!cid) throw new Error("Select a customer first (click a row in Customers).");
    if (!confirm(`Clear Netlify token for customer #${cid}?`)) return;
    await apiAdmin("/.netlify/functions/admin-netlify-token", { method: "DELETE", body: { customer_id: cid } });
    showToast("Netlify token cleared for customer.", true);
    await loadCustomers();
  }

  // ------------------------------
  // Create customer + master key
  // ------------------------------
  async function createCustomerAndKey() {
    const email = ($("#cEmail")?.value || "").trim().toLowerCase();
    const plan_name = ($("#cPlan")?.value || "").trim() || "starter";
    const monthly_cap_cents = parseInt((($("#cCap")?.value || "").trim() || "2000"), 10);
    if (!email) throw new Error("Email required");

    const c = await apiAdmin("/.netlify/functions/admin-customers", { method: "POST", body: { email, plan_name, monthly_cap_cents } });
    const customer_id = c.customer?.id;
    setSelectedCustomer(customer_id);

    const k = await apiAdmin("/.netlify/functions/admin-keys", {
      method: "POST",
      body: { customer_id, label: "master", role: "owner", monthly_cap_cents: null }
    });

    const key = k?.api_key?.key || "";
    const keyBox = $("#keyBox");
    const keyValue = $("#keyValue");
    if (keyBox && keyValue) {
      keyValue.textContent = key;
      keyBox.style.display = "block";
    }
    showToast("Created customer + master key (copy now).", true);
    await loadCustomers();
  }

  // ------------------------------
  // Keys
  // ------------------------------
  async function loadKeys() {
    const cid = parseInt((($("#kCustomerId")?.value || store.selectedCustomerId) || "").trim(), 10);
    if (!cid) throw new Error("Set Customer ID first");
    setSelectedCustomer(cid);

    const data = await apiAdmin(`/.netlify/functions/admin-keys?customer_id=${cid}`);
    const tbody = $("#keysTable tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    for (const k of (data.keys || [])) {
      const revoked = !!k.revoked_at;
      const canReveal = !!k.can_reveal;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${k.id}</td>
        <td>${escapeHtml(k.key_last4)}</td>
        <td>${escapeHtml(k.label)}</td>
        <td>${k.monthly_cap_cents === null ? "—" : money(k.monthly_cap_cents)}</td>
        <td>${k.rpm_limit === null ? "—" : k.rpm_limit}</td>
        <td>${k.max_devices === null ? "—" : k.max_devices}</td>
        <td>${k.require_install_id ? "Yes" : "No"}</td>
        <td>${k.allowed_providers ? escapeHtml((k.allowed_providers || []).join(",")) : "—"}</td>
        <td style="max-width:260px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${k.allowed_models ? escapeHtml(JSON.stringify(k.allowed_models)) : "—"}</td>
        <td>${revoked ? "Yes" : "No"}</td>
        <td>${k.created_at ? new Date(k.created_at).toLocaleString() : ""}</td>
        <td class="row-actions">
          ${canReveal ? `<button class="btn ghost" data-reveal="${k.id}" title="Copy full key to clipboard">📋 Copy</button>` : ''}
          <button class="btn ghost" data-rotate="${k.id}">Rotate</button>
          <button class="btn ${revoked ? 'ghost' : 'danger'}" data-revoke="${k.id}" data-revoked="${revoked ? '1':'0'}">${revoked ? 'Unrevoke' : 'Revoke'}</button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    // Actions — Reveal / Copy key
    tbody.querySelectorAll("button[data-reveal]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const key_id = parseInt(btn.getAttribute("data-reveal"), 10);
        try {
          const data = await apiAdmin(`/.netlify/functions/admin-keys?reveal_key_id=${key_id}`);
          const key = data?.key || "";
          if (key) {
            await copyText(key);
            // Also show it in the key display box
            const box = $("#subKeyBox");
            const val = $("#subKeyValue");
            if (box && val) {
              val.textContent = key;
              box.style.display = "block";
            }
            showToast("Key copied to clipboard.", true);
          } else {
            showToast("Could not retrieve key.", false);
          }
        } catch (e) { showToast(e.message || "Reveal failed", false); }
      });
    });

    // Actions — Revoke / Unrevoke
    tbody.querySelectorAll("button[data-revoke]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const key_id = parseInt(btn.getAttribute("data-revoke"), 10);
        const revokedNow = btn.getAttribute("data-revoked") === "1";
        try {
          await apiAdmin(`/.netlify/functions/admin-keys?key_id=${key_id}`, { method: "PATCH", body: { revoked: !revokedNow } });
          showToast(!revokedNow ? "Key revoked" : "Key unrevoked", true);
          await loadKeys();
        } catch (e) { showToast(e.message || "Failed", false); }
      });
    });

    tbody.querySelectorAll("button[data-rotate]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const rotate_key_id = parseInt(btn.getAttribute("data-rotate"), 10);
        try {
          const data = await apiAdmin(`/.netlify/functions/admin-keys?rotate_key_id=${rotate_key_id}`, { method: "PUT", body: null });
          const key = data?.new_key?.key || "";
          const box = $("#subKeyBox");
          const val = $("#subKeyValue");
          if (box && val) {
            val.textContent = key;
            box.style.display = "block";
          }
          showToast("Key rotated (new key shown).", true);
          await loadKeys();
        } catch (e) { showToast(e.message || "Rotate failed", false); }
      });
    });
  }

  async function createSubKey() {
    const customer_id = parseInt((($("#kCustomerId")?.value || store.selectedCustomerId) || "").trim(), 10);
    if (!customer_id) throw new Error("Set Customer ID first");
    setSelectedCustomer(customer_id);

    const label = ($("#kLabel")?.value || "").trim() || "subkey";

    const capRaw = ($("#kCapOverride")?.value || "").trim();
    const rpmRaw = ($("#kRpm")?.value || "").trim();
    const rpdRaw = ($("#kRpd")?.value || "").trim();

    const maxDevicesRaw = ($("#kMaxDevices")?.value || "").trim();
    const requireInstall = !!$("#kRequireInstall")?.checked;

    const allowedProvidersRaw = ($("#kAllowedProviders")?.value || "").trim();
    const allowedModelsRaw = ($("#kAllowedModels")?.value || "").trim();

    let allowed_models = null;
    if (allowedModelsRaw) {
      try { allowed_models = JSON.parse(allowedModelsRaw); }
      catch { throw new Error("Allowed models JSON is invalid"); }
    }

    const allowed_providers = allowedProvidersRaw
      ? allowedProvidersRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : null;

    warnIfUnpriced(allowed_providers, allowed_models);

    const payload = {
      customer_id,
      label,
      role: "deployer",
      monthly_cap_cents: capRaw === "" ? null : parseInt(capRaw, 10),
      rpm_limit: rpmRaw === "" ? null : parseInt(rpmRaw, 10),
      rpd_limit: rpdRaw === "" ? null : parseInt(rpdRaw, 10),
      max_devices: maxDevicesRaw === "" ? null : parseInt(maxDevicesRaw, 10),
      require_install_id: requireInstall,
      allowed_providers,
      allowed_models
    };

    const data = await apiAdmin("/.netlify/functions/admin-keys", { method: "POST", body: payload });
    const key = data?.api_key?.key || "";
    const box = $("#subKeyBox");
    const val = $("#subKeyValue");
    if (box && val) {
      val.textContent = key;
      box.style.display = "block";
    }
    showToast("Created sub-key (copy now).", true);
    await loadKeys();
  }

  // ------------------------------
  // Usage
  // ------------------------------
  async function loadUsage() {
    const cid = parseInt((($("#uCustomerId")?.value || store.selectedCustomerId) || "").trim(), 10);
    if (!cid) throw new Error("Set Customer ID first");
    setSelectedCustomer(cid);

    const month = ($("#uMonth")?.value || "").trim() || monthKeyUTC();

    const data = await apiAdmin(`/.netlify/functions/admin-usage?customer_id=${cid}&month=${encodeURIComponent(month)}`);

    const cap = data?.customer?.monthly_cap_cents ?? 0;
    const roll = data?.rollup || {};
    const spent = roll.spent_cents ?? 0;
    const extra = roll.extra_cents ?? 0;
    const tokens = Number(roll.input_tokens || 0) + Number(roll.output_tokens || 0);

    $("#usageSummary") && ($("#usageSummary").style.display = "grid");
    $("#sCap") && ($("#sCap").textContent = money(cap));
    $("#sExtra") && ($("#sExtra").textContent = money(extra));
    $("#sSpent") && ($("#sSpent").textContent = money(spent));
    $("#sTok") && ($("#sTok").textContent = String(tokens));

    // events
    const tbody = $("#eventsTable tbody");
    if (tbody) {
      tbody.innerHTML = "";
      for (const ev of (data.events || [])) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${ev.created_at ? new Date(ev.created_at).toLocaleString() : ""}</td>
          <td>${escapeHtml(ev.provider)}</td>
          <td>${escapeHtml(ev.model)}</td>
          <td>${Number(ev.input_tokens || 0)}</td>
          <td>${Number(ev.output_tokens || 0)}</td>
          <td>${Number(ev.cost_cents || 0)}</td>
        `;
        tbody.appendChild(tr);
      }
    }
  }

  // ------------------------------
  // Billing & Controls
  // ------------------------------
  function getCustomerFromCache(cid) {
    return (customersCache || []).find((c) => String(c.id) === String(cid));
  }

  async function loadCustomerConfig() {
    if (!customersCache.length) await loadCustomers();

    const cid = parseInt((($("#billCustomerId")?.value || store.selectedCustomerId) || "").trim(), 10);
    if (!cid) throw new Error("Set Customer ID first");
    setSelectedCustomer(cid);

    const c = getCustomerFromCache(cid);
    if (!c) throw new Error("Customer not found (refresh Customers tab)");

    $("#custPlan").value = c.plan_name || "";
    $("#custCap").value = c.monthly_cap_cents ?? "";
    $("#custActive").checked = !!c.is_active;

    $("#custMaxDevices").value = c.max_devices_per_key ?? "";
    $("#custRequireInstall").checked = !!c.require_install_id;
    $("#custAllowedProviders").value = (c.allowed_providers || []).join(",");
    $("#custAllowedModels").value = c.allowed_models ? JSON.stringify(c.allowed_models, null, 2) : "";

    $("#billMonth").value = ($("#billMonth").value || "").trim() || monthKeyUTC();

    showToast("Loaded customer config.", true);
  }

  async function saveCustomerConfig() {
    const cid = parseInt((($("#billCustomerId")?.value || store.selectedCustomerId) || "").trim(), 10);
    if (!cid) throw new Error("Set Customer ID first");

    const allowedProvidersRaw = ($("#custAllowedProviders")?.value || "").trim();
    const allowedModelsRaw = ($("#custAllowedModels")?.value || "").trim();

    let allowed_models = null;
    if (allowedModelsRaw) {
      try { allowed_models = JSON.parse(allowedModelsRaw); }
      catch { throw new Error("Allowed models JSON is invalid"); }
    }

    const allowed_providers = allowedProvidersRaw
      ? allowedProvidersRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : null;

    warnIfUnpriced(allowed_providers, allowed_models);

    const body = {
      plan_name: ($("#custPlan")?.value || "").trim() || null,
      monthly_cap_cents: ($("#custCap")?.value || "").trim() === "" ? null : parseInt($("#custCap").value.trim(), 10),
      is_active: !!$("#custActive")?.checked,
      max_devices_per_key: ($("#custMaxDevices")?.value || "").trim() === "" ? null : parseInt($("#custMaxDevices").value.trim(), 10),
      require_install_id: !!$("#custRequireInstall")?.checked,
      allowed_providers,
      allowed_models
    };

    await apiAdmin(`/.netlify/functions/admin-customers?customer_id=${cid}`, { method: "PATCH", body });
    showToast("Saved customer config.", true);
    await loadCustomers();
  }

  async function manualTopup() {
    const cid = parseInt((($("#billCustomerId")?.value || store.selectedCustomerId) || "").trim(), 10);
    if (!cid) throw new Error("Set Customer ID first");

    const month = ($("#billMonth")?.value || "").trim() || monthKeyUTC();
    const amount_cents = parseInt((($("#topupCents")?.value || "").trim() || "0"), 10);
    if (!Number.isFinite(amount_cents) || amount_cents <= 0) throw new Error("amount_cents must be > 0");

    await apiAdmin("/.netlify/functions/admin-topup", { method: "POST", body: { customer_id: cid, month, amount_cents } });
    showToast("Manual top-up applied.", true);
  }

  async function stripeTopup() {
    const cid = parseInt((($("#billCustomerId")?.value || store.selectedCustomerId) || "").trim(), 10);
    if (!cid) throw new Error("Set Customer ID first");

    const month = ($("#billMonth")?.value || "").trim() || monthKeyUTC();
    const amount_cents = parseInt((($("#stripeTopupCents")?.value || "").trim() || "0"), 10);
    if (!Number.isFinite(amount_cents) || amount_cents <= 0) throw new Error("amount_cents must be > 0");

    const data = await apiAdmin("/.netlify/functions/stripe-create-checkout", { method: "POST", body: { customer_id: cid, month, amount_cents } });
    const a = $("#stripeTopupLink");
    if (a) {
      a.href = data.url;
      a.style.display = "inline-flex";
    }
    showToast("Stripe checkout created.", true);
  }

  async function loadInvoice() {
    const cid = parseInt((($("#billCustomerId")?.value || store.selectedCustomerId) || "").trim(), 10);
    if (!cid) throw new Error("Set Customer ID first");
    const month = ($("#billMonth")?.value || "").trim() || monthKeyUTC();

    const data = await apiAdmin(`/.netlify/functions/admin-invoices?customer_id=${cid}&month=${encodeURIComponent(month)}`);
    $("#adminInvoiceJson").textContent = JSON.stringify(data, null, 2);
  }

  async function createInvoice() {
    const cid = parseInt((($("#billCustomerId")?.value || store.selectedCustomerId) || "").trim(), 10);
    if (!cid) throw new Error("Set Customer ID first");
    const month = ($("#billMonth")?.value || "").trim() || monthKeyUTC();

    const data = await apiAdmin(`/.netlify/functions/admin-invoices?customer_id=${cid}&month=${encodeURIComponent(month)}`, { method: "POST", body: null });
    $("#adminInvoiceJson").textContent = JSON.stringify(data, null, 2);
    showToast("Invoice snapshot saved.", true);
  }

  // ------------------------------
  // Devices
  // ------------------------------
  async function loadDevices() {
    const cid = parseInt((($("#devCustomerId")?.value || store.selectedCustomerId) || "").trim(), 10);
    if (!cid) throw new Error("Set Customer ID first");
    setSelectedCustomer(cid);

    const keyIdRaw = ($("#devKeyId")?.value || "").trim();
    const qs = new URLSearchParams({ customer_id: String(cid) });
    if (keyIdRaw) qs.set("api_key_id", keyIdRaw);

    const data = await apiAdmin(`/.netlify/functions/admin-devices?${qs.toString()}`);
    const tbody = $("#adminDevicesTable tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    for (const d of (data.devices || [])) {
      const revoked = !!d.revoked_at;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>#${d.api_key_id} (${escapeHtml(d.key_last4)} ${escapeHtml(d.key_label || "")})</td>
        <td><code>${escapeHtml(d.install_id)}</code></td>
        <td>${d.first_seen_at ? new Date(d.first_seen_at).toLocaleString() : ""}</td>
        <td>${d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : ""}</td>
        <td>${revoked ? "Yes" : "No"}</td>
        <td style="max-width:420px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(d.last_seen_ua || "")}</td>
        <td><button class="btn ${revoked ? "ghost" : "danger"}" data-install="${escapeHtml(d.install_id)}" data-key="${d.api_key_id}" data-revoked="${revoked ? "1":"0"}">${revoked ? "Unrevoke" : "Revoke"}</button></td>
      `;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll("button[data-install]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const api_key_id = parseInt(btn.getAttribute("data-key"), 10);
        const install_id = btn.getAttribute("data-install");
        const revokedNow = btn.getAttribute("data-revoked") === "1";
        await apiAdmin("/.netlify/functions/admin-devices", { method: "PATCH", body: { api_key_id, install_id, revoked: !revokedNow } });
        showToast(!revokedNow ? "Device revoked" : "Device unrevoked", true);
        await loadDevices();
      });
    });
  }

  // ------------------------------
  // Exports
  // ------------------------------
  async function adminExport(type) {
    const cid = parseInt((($("#expCustomerId")?.value || store.selectedCustomerId) || "").trim(), 10);
    if (!cid) throw new Error("Set Customer ID first");
    setSelectedCustomer(cid);

    const month = ($("#expMonth")?.value || "").trim() || monthKeyUTC();
    const key_id = ($("#expKeyId")?.value || "").trim();

    const qs = new URLSearchParams({ customer_id: String(cid), month, type });
    if (key_id) qs.set("api_key_id", key_id);

    const filename = `kaixu-admin-${type}-${month}-customer${cid}${key_id ? ("-key" + key_id) : ""}.csv`;
    await downloadAdmin(`/.netlify/functions/admin-export?${qs.toString()}`, filename);
  }

// ------------------------------
// KaixuPush (Deploy Proxy) - Admin UI
// ------------------------------
function pushCid() {
  const cid = parseInt((($("#pushCustomerId")?.value || store.selectedCustomerId) || "").trim(), 10);
  if (!cid) throw new Error("Set Customer ID first (select a customer row).");
  setSelectedCustomer(cid);
  return cid;
}

function pushMonth() {
  const m = ($("#pushMonth")?.value || "").trim() || monthKeyUTC();
  if (!/^\d{4}-\d{2}$/.test(m)) throw new Error("Invalid month. Use YYYY-MM");
  return m;
}

function clearPushProjectForm() {
  const a = $("#pushProjectId"); if (a) a.value = "";
  const b = $("#pushProjectName"); if (b) b.value = "";
  const c = $("#pushNetlifySiteId"); if (c) c.value = "";
}

async function loadPushProjects() {
  const cid = pushCid();
  const data = await apiAdmin(`/.netlify/functions/admin-push-projects?customer_id=${cid}`);
  const tbody = $("#pushProjectsTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const pr of (data.projects || [])) {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td>${pr.id}</td>
      <td><code>${escapeHtml(pr.project_id)}</code></td>
      <td>${escapeHtml(pr.name)}</td>
      <td><code>${escapeHtml(pr.netlify_site_id)}</code></td>
      <td>${pr.updated_at ? new Date(pr.updated_at).toLocaleString() : ""}</td>
      <td><button class="btn danger" data-del="${pr.id}">Delete</button></td>
    `;
    tr.addEventListener("click", (e) => {
      // avoid clicking delete button triggering form fill twice
      const target = e.target;
      if (target && target.getAttribute && target.getAttribute("data-del")) return;
      const pid = $("#pushProjectId"); if (pid) pid.value = pr.project_id || "";
      const nm = $("#pushProjectName"); if (nm) nm.value = pr.name || "";
      const sid = $("#pushNetlifySiteId"); if (sid) sid.value = pr.netlify_site_id || "";
    });
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.getAttribute("data-del"), 10);
      if (!confirm(`Delete push project #${id}? This will also delete its deploy history.`)) return;
      await apiAdmin("/.netlify/functions/admin-push-projects", { method: "DELETE", body: { customer_id: pushCid(), id } });
      showToast("Project deleted.", true);
      await loadPushProjects();
    });
  });
}

async function savePushProject() {
  const cid = pushCid();
  const project_id = ($("#pushProjectId")?.value || "").trim();
  const name = ($("#pushProjectName")?.value || "").trim();
  const netlify_site_id = ($("#pushNetlifySiteId")?.value || "").trim();
  if (!project_id) throw new Error("Project ID required");
  if (!name) throw new Error("Project name required");
  if (!netlify_site_id) throw new Error("Netlify Site ID required");

  await apiAdmin("/.netlify/functions/admin-push-projects", {
    method: "POST",
    body: { customer_id: cid, project_id, name, netlify_site_id }
  });

  showToast("Project saved.", true);
  await loadPushProjects();
}

async function loadPushDeploys() {
  const cid = pushCid();
  const m = pushMonth();
  const data = await apiAdmin(`/.netlify/functions/admin-push-deploys?customer_id=${cid}&month=${encodeURIComponent(m)}&limit=200`);
  const tbody = $("#pushDeploysTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const d of (data.deploys || [])) {
    const url = d.url ? `<a href="${escapeHtml(d.url)}" target="_blank" rel="noreferrer">open</a>` : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code>${escapeHtml(d.push_id)}</code></td>
      <td>${escapeHtml(d.project_id)}<div class="muted small">${escapeHtml(d.project_name || "")}</div></td>
      <td>${escapeHtml(d.branch || "")}</td>
      <td>${escapeHtml(d.state || "")}</td>
      <td>${escapeHtml(String(d.required_count || 0))}</td>
      <td>${escapeHtml(String(d.uploaded_count || 0))}</td>
      <td>${url}</td>
      <td>${d.created_at ? new Date(d.created_at).toLocaleString() : ""}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function loadPushJobs() {
  const cid = pushCid();
  const m = pushMonth();
  const data = await apiAdmin(`/.netlify/functions/admin-push-jobs?customer_id=${cid}&month=${encodeURIComponent(m)}&limit=200`);
  const tbody = $("#pushJobsTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const j of (data.jobs || [])) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code>${escapeHtml(j.push_id)}</code></td>
      <td>${escapeHtml(j.project_id)}</td>
      <td style="max-width:360px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><code>${escapeHtml(j.deploy_path)}</code></td>
      <td style="max-width:220px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><code>${escapeHtml(j.sha1)}</code></td>
      <td>${escapeHtml(String(j.parts || ""))}</td>
      <td>${escapeHtml(String(j.received_count || 0))}</td>
      <td>${escapeHtml(String(j.bytes_staged || 0))}</td>
      <td>${escapeHtml(j.status || "")}</td>
      <td>${j.updated_at ? new Date(j.updated_at).toLocaleString() : ""}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function loadPushInvoices() {
  const cid = pushCid();
  const data = await apiAdmin(`/.netlify/functions/admin-push-invoices?customer_id=${cid}`);
  const tbody = $("#pushInvoicesTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const inv of (data.invoices || [])) {
    const bd = inv.breakdown || {};
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code>${escapeHtml(inv.month)}</code></td>
      <td>${money(inv.total_cents || 0)}</td>
      <td>v${escapeHtml(String(inv.pricing_version || ""))}</td>
      <td>${escapeHtml(String(bd.deploys_ready || ""))}</td>
      <td>${escapeHtml(String(bd.bytes_uploaded || ""))}</td>
      <td>${inv.updated_at ? new Date(inv.updated_at).toLocaleString() : ""}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function generatePushInvoice() {
  const cid = pushCid();
  const m = pushMonth();
  const data = await apiAdmin("/.netlify/functions/admin-push-invoices", { method: "POST", body: { customer_id: cid, month: m } });
  showToast(`Push invoice generated: ${money(data?.breakdown?.total_cents || 0)}`, true);
  await loadPushInvoices();
}

  // ------------------------------
  // Monitor
  // ------------------------------
  let monAfterId = 0;
  let monLive = false;
  let monEs = null;

  function monStatus(s) {
    const el = $("#monStatus");
    if (el) el.textContent = s;
  }

  function buildMonitorQS({ after_id } = {}) {
    const qs = new URLSearchParams();
    if (after_id !== undefined && after_id !== null) qs.set("after_id", String(after_id));

    const level = ($("#monLevel")?.value || "").trim();
    const kind = ($("#monKind")?.value || "").trim();
    const fn = ($("#monFn")?.value || "").trim();
    const app = ($("#monApp")?.value || "").trim();
    const request_id = ($("#monRequestId")?.value || "").trim();

    if (level) qs.set("level", level);
    if (kind) qs.set("kind", kind);
    if (fn) qs.set("function", fn);
    if (app) qs.set("app", app);
    if (request_id) qs.set("request_id", request_id);

    return qs.toString();
  }

  function renderMonitorRow(ev) {
    const tbody = $("#monitorTable tbody");
    if (!tbody) return;

    const summary = ev.error_message || ev.error_code || (ev.upstream_status ? `upstream ${ev.upstream_status}` : "");
    const status = ev.http_status || ev.upstream_status || "";
    const provModel = (ev.provider || "") + (ev.model ? ("/" + ev.model) : "");
    const req = ev.request_id || "";

    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td>${ev.created_at ? new Date(ev.created_at).toLocaleString() : ""}</td>
      <td>${escapeHtml(ev.level || "")}</td>
      <td>${escapeHtml(ev.function_name || "")}</td>
      <td>${escapeHtml(ev.app_id || "")}</td>
      <td>${escapeHtml(String(status))}</td>
      <td>${escapeHtml(provModel)}</td>
      <td>${escapeHtml(String(ev.duration_ms || ""))}</td>
      <td style="max-width:220px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><code>${escapeHtml(req)}</code></td>
      <td style="max-width:420px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(summary)}</td>
    `;
    tr.addEventListener("click", () => openMonitorDetail(ev));
    tbody.appendChild(tr);
  }

  function clearMonitorTable() {
    const tbody = $("#monitorTable tbody");
    if (tbody) tbody.innerHTML = "";
  }

  function openMonitorDetail(ev) {
    const modal = $("#monitorModal");
    const detail = $("#monDetail");
    if (!modal || !detail) return;

    detail.textContent = JSON.stringify(ev, null, 2);
    modal.style.display = "flex";

    const copyBtn = $("#monCopyBtn");
    if (copyBtn) {
      copyBtn.onclick = async () => {
        await copyText(detail.textContent || "");
        showToast("Copied event JSON.", true);
      };
    }
  }

  function closeMonitorDetail() {
    const modal = $("#monitorModal");
    if (modal) modal.style.display = "none";
  }

  async function monitorSearch(reset = true) {
    if (reset) {
      monAfterId = 0;
      clearMonitorTable();
    }
    monStatus("loading");

    const qs = buildMonitorQS({ after_id: monAfterId });
    const data = await apiAdmin(`/.netlify/functions/admin-monitor-events?${qs}`);
    const events = data.events || [];

    for (const ev of events) renderMonitorRow(ev);
    monAfterId = data.next_after_id || monAfterId;

    monStatus(events.length ? "ok" : "idle");
  }

  function monitorStartLive() {
    if (monLive) return;
    monLive = true;
    monStatus("live");

    const qs = buildMonitorQS({ after_id: monAfterId });
    const url = apiUrl(`/.netlify/functions/admin-monitor-stream?${qs}`);

    // Use fetch() + ReadableStream to include Authorization header (EventSource can't set headers).
    const token = store.adminToken;
    const controller = new AbortController();

    const pump = async () => {
      const res = await fetch(url, {
        method: "GET",
        headers: { "authorization": `Bearer ${token}` },
        signal: controller.signal
      });

      if (res.status === 401) {
        clearAuth();
        monStatus("unauthorized");
        monLive = false;
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (monLive) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        // SSE frames separated by \n\n
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);

          const lines = frame.split("\n");
          let eventName = "message";
          let dataLine = "";
          for (const line of lines) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            if (line.startsWith("data:")) dataLine += line.slice(5).trim();
          }
          if (eventName === "event") {
            try {
              const ev = JSON.parse(dataLine);
              monAfterId = Math.max(monAfterId, ev.id || 0);
              renderMonitorRow(ev);
            } catch { }
          }
        }
      }
    };

    monEs = { controller };
    pump().catch(() => {
      if (monLive) monStatus("disconnected");
    });
  }

  function monitorStopLive() {
    monLive = false;
    if (monEs?.controller) {
      try { monEs.controller.abort(); } catch { }
    }
    monEs = null;
    monStatus("idle");
  }

  async function monitorPrune() {
    const daysStr = prompt("Prune monitor events older than how many days?", "30");
    if (!daysStr) return;
    const days = parseInt(daysStr, 10);
    if (!Number.isFinite(days) || days <= 0) throw new Error("Days must be a positive number");
    const data = await apiAdmin("/.netlify/functions/admin-monitor-prune", { method: "POST", body: { days } });
    showToast(`Pruned ${data.deleted || 0} events.`, true);
    await monitorSearch(true);
  }

  // ------------------------------
  // Gateway Base modal
  // ------------------------------
  function effectiveBase() {
    const b = normalizeBase(baseStore.apiBase);
    return b || window.location.origin;
  }

  function openBaseModal() {
    const modal = $("#baseModal");
    if (!modal) return;

    const input = $("#apiBaseInput");
    const current = $("#apiBaseCurrent");
    const health = $("#apiBaseHealthLink");

    const saved = normalizeBase(baseStore.apiBase);
    if (input) input.value = saved;
    if (current) current.textContent = effectiveBase();
    if (health) health.href = (normalizeBase(saved) || "") + "/.netlify/functions/health";

    modal.style.display = "flex";
  }

  function closeBaseModal() {
    const modal = $("#baseModal");
    if (modal) modal.style.display = "none";
  }

  function saveBaseModal() {
    const input = $("#apiBaseInput");
    const v = normalizeBase(input?.value || "");
    baseStore.apiBase = v;
    showToast("Gateway Base saved.", true);
    closeBaseModal();
  }

  function useThisSite() {
    baseStore.apiBase = "";
    showToast("Gateway Base cleared (using this site).", true);
    closeBaseModal();
  }

  // ------------------------------
  // Wiring
  // ------------------------------
  $("#gatewayBaseBtn")?.addEventListener("click", openBaseModal);
  $("#apiBaseClose")?.addEventListener("click", closeBaseModal);
  $("#apiBaseSave")?.addEventListener("click", saveBaseModal);
  $("#apiBaseUseThisSite")?.addEventListener("click", useThisSite);
  $("#baseModal")?.addEventListener("click", (e) => {
    if (e.target && e.target.id === "baseModal") closeBaseModal();
  });

  $("#monCloseBtn")?.addEventListener("click", closeMonitorDetail);
  $("#monitorModal")?.addEventListener("click", (e) => {
    if (e.target && e.target.id === "monitorModal") closeMonitorDetail();
  });

  $("#refreshCustomers")?.addEventListener("click", () => loadCustomers().catch((e) => showToast(e.message, false)));
  $("#setNetlifyToken")?.addEventListener("click", () => setNetlifyTokenForSelectedCustomer().catch((e) => showToast(e.message, false)));
  $("#clearNetlifyToken")?.addEventListener("click", () => clearNetlifyTokenForSelectedCustomer().catch((e) => showToast(e.message, false)));

  $("#createBtn")?.addEventListener("click", () => createCustomerAndKey().catch((e) => showToast(e.message, false)));
  $("#copyKey")?.addEventListener("click", async () => {
    await copyText($("#keyValue")?.textContent || "");
    showToast("Copied key.", true);
  });

  $("#loadKeys")?.addEventListener("click", () => loadKeys().catch((e) => showToast(e.message, false)));
  $("#refreshKeys")?.addEventListener("click", () => loadKeys().catch((e) => showToast(e.message, false)));
  $("#createSubKey")?.addEventListener("click", () => createSubKey().catch((e) => showToast(e.message, false)));
  $("#copySubKey")?.addEventListener("click", async () => {
    await copyText($("#subKeyValue")?.textContent || "");
    showToast("Copied sub-key.", true);
  });

  $("#loadUsage")?.addEventListener("click", () => loadUsage().catch((e) => showToast(e.message, false)));

  $("#loadCustomerConfig")?.addEventListener("click", () => loadCustomerConfig().catch((e) => showToast(e.message, false)));
  $("#saveCustomerConfig")?.addEventListener("click", () => saveCustomerConfig().catch((e) => showToast(e.message, false)));
  $("#manualTopupBtn")?.addEventListener("click", () => manualTopup().catch((e) => showToast(e.message, false)));
  $("#stripeTopupBtn")?.addEventListener("click", () => stripeTopup().catch((e) => showToast(e.message, false)));
  $("#loadInvoiceBtn")?.addEventListener("click", () => loadInvoice().catch((e) => showToast(e.message, false)));
  $("#createInvoiceBtn")?.addEventListener("click", () => createInvoice().catch((e) => showToast(e.message, false)));

  $("#loadDevicesBtn")?.addEventListener("click", () => loadDevices().catch((e) => showToast(e.message, false)));

  $("#admDlEvents")?.addEventListener("click", () => adminExport("events").catch((e) => showToast(e.message, false)));
  $("#admDlSummary")?.addEventListener("click", () => adminExport("summary").catch((e) => showToast(e.message, false)));
  $("#admDlInvoice")?.addEventListener("click", () => adminExport("invoice").catch((e) => showToast(e.message, false)));


$("#pushLoadProjects")?.addEventListener("click", () => loadPushProjects().catch((e) => showToast(e.message, false)));
$("#pushSaveProject")?.addEventListener("click", () => savePushProject().catch((e) => showToast(e.message, false)));
$("#pushClearProjectForm")?.addEventListener("click", () => { clearPushProjectForm(); showToast("Cleared.", true); });
$("#pushLoadDeploys")?.addEventListener("click", () => loadPushDeploys().catch((e) => showToast(e.message, false)));
$("#pushLoadJobs")?.addEventListener("click", () => loadPushJobs().catch((e) => showToast(e.message, false)));
$("#pushLoadInvoices")?.addEventListener("click", () => loadPushInvoices().catch((e) => showToast(e.message, false)));
$("#pushGenInvoice")?.addEventListener("click", () => generatePushInvoice().catch((e) => showToast(e.message, false)));

  $("#monSearchBtn")?.addEventListener("click", () => monitorSearch(true).catch((e) => showToast(e.message, false)));
  $("#monRefreshBtn")?.addEventListener("click", () => monitorSearch(true).catch((e) => showToast(e.message, false)));
  $("#monClearBtn")?.addEventListener("click", () => { clearMonitorTable(); monAfterId = 0; showToast("Cleared monitor table.", true); });
  $("#monPruneBtn")?.addEventListener("click", () => monitorPrune().catch((e) => showToast(e.message, false)));
  $("#monLiveBtn")?.addEventListener("click", () => {
    if (!monLive) {
      $("#monLiveBtn").textContent = "Stop Live";
      monitorStartLive();
    } else {
      $("#monLiveBtn").textContent = "Start Live";
      monitorStopLive();
    }
  });

  // Login / logout
  $("#loginBtn")?.addEventListener("click", async () => {
    const passEl = $("#adminPassword");
    const password = (passEl?.value || "").trim();
    if (!password) return showToast("Enter admin password.", false);
    try {
      const token = await adminLoginWithPassword(password);
      store.adminToken = token;

      // Don't keep password around
      if (passEl) passEl.value = "";

      setAuthUI(true);
      showToast("Logged in.", true);

      // Load initial data
      await loadCustomers();

      // Set default month fields
      const m1 = $("#uMonth"); if (m1 && !m1.value) m1.value = monthKeyUTC();
      const m2 = $("#billMonth"); if (m2 && !m2.value) m2.value = monthKeyUTC();
      const m3 = $("#expMonth"); if (m3 && !m3.value) m3.value = monthKeyUTC();
    const m4 = $("#pushMonth"); if (m4 && !m4.value) m4.value = monthKeyUTC();
    } catch (e) {
      clearAuth();
      showToast(e.message || "Login failed", false);
    }
  });

  $("#logoutBtn")?.addEventListener("click", async () => {
    monitorStopLive();
    clearAuth();
    showToast("Logged out.", true);
  });

  // Boot
  (function boot() {

// Mount priced-model allowlist pickers (writes into existing JSON textareas)
mountPricedModelPicker("#kAllowedModels", "#kAllowedProviders");
mountPricedModelPicker("#custAllowedModels", "#custAllowedProviders");

    // Restore selected customer
    if (store.selectedCustomerId) setSelectedCustomer(store.selectedCustomerId);

    // If we already have a token in session, show app immediately
    if (store.adminToken) {
      setAuthUI(true);
      loadCustomers().catch(() => {
        // If token invalid/expired, force login
        clearAuth();
      });
    } else {
      setAuthUI(false);
    }

    // Default months
    const m1 = $("#uMonth"); if (m1 && !m1.value) m1.value = monthKeyUTC();
    const m2 = $("#billMonth"); if (m2 && !m2.value) m2.value = monthKeyUTC();
    const m3 = $("#expMonth"); if (m3 && !m3.value) m3.value = monthKeyUTC();
    const m4 = $("#pushMonth"); if (m4 && !m4.value) m4.value = monthKeyUTC();
  })();



// ------------------------------
// GitHub Push (admin operator UI)
// ------------------------------
function ghCid() {
  const v = ($("#ghCustomerId")?.value || "").trim();
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error("Enter a valid Customer ID for GitHub.");
  return n;
}
function ghLimit() {
  const v = ($("#ghLimit")?.value || "50").trim();
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 && n <= 200 ? n : 50;
}

async function ghTokenStatus() {
  const cid = ghCid();
  const data = await apiAdmin(`/.netlify/functions/admin-github-token?customer_id=${cid}`);
  showToast(data.has_token ? `GitHub token present (${data.token_type || "unknown"})` : "No GitHub token configured.", !!data.has_token);
  return data;
}

async function ghTokenSet() {
  const cid = ghCid();
  const token = ($("#ghPat")?.value || "").trim();
  if (!token) throw new Error("Paste a GitHub PAT first.");
  await apiAdmin(`/.netlify/functions/admin-github-token`, {
    method: "POST",
    body: JSON.stringify({ customer_id: cid, token, token_type: "pat", scopes: [] })
  });
  ($("#ghPat").value = "");
  showToast("GitHub token saved (encrypted).", true);
}

async function ghTokenClear() {
  const cid = ghCid();
  await apiAdmin(`/.netlify/functions/admin-github-token`, {
    method: "DELETE",
    body: JSON.stringify({ customer_id: cid })
  });
  showToast("GitHub token cleared.", true);
}

async function ghLoadRepos() {
  const cid = ghCid();
  const data = await apiAdmin(`/.netlify/functions/admin-github-repos?customer_id=${cid}`);
  const tbody = $("#ghReposTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const r of (data.repos || [])) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code>${escapeHtml(r.full_name)}</code></td>
      <td>${r.private ? "yes" : "no"}</td>
      <td>${escapeHtml(r.default_branch || "")}</td>
      <td>${r.updated_at ? new Date(r.updated_at).toLocaleString() : ""}</td>
      <td>${r.html_url ? `<a href="${escapeAttr(r.html_url)}" target="_blank" rel="noreferrer">Open</a>` : ""}</td>
    `;
    tbody.appendChild(tr);
  }
  showToast(`Loaded ${data.repos?.length || 0} repos.`, true);
}

async function ghLoadJobs() {
  const cid = ghCid();
  const lim = ghLimit();
  const data = await apiAdmin(`/.netlify/functions/admin-gh-jobs?customer_id=${cid}&limit=${lim}`);
  const tbody = $("#ghJobsTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const j of (data.jobs || [])) {
    const tr = document.createElement("tr");
    const repo = `${j.owner}/${j.repo}`;
    const result = j.result_url ? `<a href="${escapeAttr(j.result_url)}" target="_blank" rel="noreferrer">Commit</a>` : "";
    tr.innerHTML = `
      <td><code>${escapeHtml(j.job_id)}</code></td>
      <td><code>${escapeHtml(repo)}</code></td>
      <td><code>${escapeHtml(j.branch)}</code></td>
      <td>${escapeHtml(j.status)}</td>
      <td>${formatBytes(j.bytes_staged || 0)}</td>
      <td>${j.attempts || 0}</td>
      <td>${j.updated_at ? new Date(j.updated_at).toLocaleString() : ""}</td>
      <td>${result}</td>
    `;
    tbody.appendChild(tr);
  }
  showToast(`Loaded ${data.jobs?.length || 0} GitHub jobs.`, true);
}

// Wire events (safe if elements absent)
$("#ghTokenStatus")?.addEventListener("click", () => ghTokenStatus().catch((e) => showToast(e.message, false)));
$("#ghTokenSet")?.addEventListener("click", () => ghTokenSet().catch((e) => showToast(e.message, false)));
$("#ghTokenClear")?.addEventListener("click", () => ghTokenClear().catch((e) => showToast(e.message, false)));
$("#ghLoadRepos")?.addEventListener("click", () => ghLoadRepos().catch((e) => showToast(e.message, false)));
$("#ghLoadJobs")?.addEventListener("click", () => ghLoadJobs().catch((e) => showToast(e.message, false)));


})();
