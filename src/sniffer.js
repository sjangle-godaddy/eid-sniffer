/**
 * EID Sniffer — MAIN-world payload for the Chrome extension.
 *
 * Derived from the original console-paste script (../eid-sniffer.js). It
 * intercepts `fetch`, `XMLHttpRequest` and `navigator.sendBeacon` to capture
 * events fired at the SST collect endpoints and surfaces each event's `eid` +
 * `customProperties` either to the console or as on-page toasts.
 *
 * This file runs in the page's MAIN world (so it can see the page's own
 * fetch/XHR). Config is delivered from the extension via a `__eidSnifferConfig`
 * CustomEvent dispatched by the ISOLATED-world bridge (src/bridge.js), and can
 * be updated live without re-injecting.
 *
 * Controls (available on the page as `window.__eidSniffer`):
 *   __eidSniffer.stop()        // restore original fetch/XHR/sendBeacon, remove toasts
 *   __eidSniffer.events        // array of every captured event
 *   __eidSniffer.clear()       // empty the captured events array
 *   __eidSniffer.setVerbose(b) // toggle full-payload console logging
 */
(() => {
  const CONFIG_EVENT = "__eidSnifferConfig";

  // Legacy TCC collect endpoint (prod) OR the newer Signals eventbus endpoint.
  const COLLECT_PATTERN = /\/csp\/collect(?:[?/]|$)/;
  const WEB_PATTERN = /\/eventbus\/web(?:[?/]|$)/;
  const COLLECT_URL_PATTERN = /(?:\/csp\/collect|\/eventbus\/web)(?:[?/]|$)/;

  // Replace any previous hook (safe to re-inject).
  if (window.__eidSniffer && typeof window.__eidSniffer.stop === "function") {
    try {
      window.__eidSniffer.stop();
    } catch (_) {
      /* ignore */
    }
  }

  const originalFetch = window.fetch;
  const OriginalXHR = window.XMLHttpRequest;
  const originalXHROpen = OriginalXHR.prototype.open;
  const originalXHRSend = OriginalXHR.prototype.send;

  const state = {
    events: [],
    verbose: false,
  };

  // Live config; updated by the CONFIG_EVENT listener. Defaults track both
  // endpoints and log to the console until the bridge delivers real config.
  // Console and toast are independent — either, both, or neither may be on.
  const POPUP_TIMEOUTS = [3, 6, 8, 10, 15, 20, 30];

  const config = {
    trackCollect: false,
    trackWeb: true,
    showConsole: true,
    showToast: true,
    popupTimeout: 6, // seconds
    copyMode: "eid", // "eid" | "eidProps"
    theme: "glass", // "glass" | "dracula"
  };

  const consoleStyles = {
    header: "color:#fff;background:#6c5ce7;padding:2px 6px;border-radius:3px;font-weight:bold",
    eid: "color:#00b894;font-weight:bold",
    label: "color:#888",
    empty: "color:#b2bec3;font-style:italic",
  };

  const getEndpointTag = (url) => {
    if (COLLECT_PATTERN.test(url || "")) return "collect";
    if (WEB_PATTERN.test(url || "")) return "web";
    return "unknown";
  };

  const shouldShow = (tag) => {
    if (tag === "collect") return config.trackCollect;
    if (tag === "web") return config.trackWeb;
    return true;
  };

  const safeParse = (body) => {
    if (!body) return null;
    if (typeof body !== "string") {
      try {
        body = String(body);
      } catch (_) {
        return null;
      }
    }
    try {
      return JSON.parse(body);
    } catch (_) {
      return null;
    }
  };

  const extractEvents = (payload) => {
    const out = [];
    if (!payload || typeof payload !== "object") return out;
    const dataArr = Array.isArray(payload.data) ? payload.data : [];
    for (const entry of dataArr) {
      const events = Array.isArray(entry?.events) ? entry.events : [];
      for (const evt of events) {
        const traffic = evt?.data?.traffic ?? {};
        const eid = traffic?.eid ?? evt?.data?.eid ?? null;
        const customProperties = traffic?.customProperties ?? {};
        if (eid || (customProperties && Object.keys(customProperties).length > 0)) {
          out.push({
            eid,
            customProperties,
            element: evt?.element ?? null,
            schemaId: evt?.schemaId ?? null,
            timestamp: evt?.data?.eventCreationTimestamp ?? null,
          });
        }
      }
    }
    return out;
  };

  /* ---------------------------------------------------------------- output */

  const logToConsole = (tag, e) => {
    const label = `[EID /${tag}]`;
    console.log(`%c${label}%c eid: ${e.eid ?? "(none)"}`, consoleStyles.header, consoleStyles.eid);
    const hasCustom = e.customProperties && Object.keys(e.customProperties).length > 0;
    console.log(
      `%c${label}%c customProperties: %c${hasCustom ? JSON.stringify(e.customProperties) : "{}"}`,
      consoleStyles.header,
      consoleStyles.label,
      hasCustom ? "color:inherit" : consoleStyles.empty
    );
    if (state.verbose) {
      console.log(`%c${label}%c full:`, consoleStyles.header, consoleStyles.label, e);
    }
  };

  /* ------ toast UI (isolated in a shadow root so page CSS can't touch it) - */

  const TOAST_MAX = 6;
  const TOAST_GLASS_OPACITY = 0.06;

  const toast = {
    host: null,
    root: null,
    stack: null,
  };

  const TOAST_CSS = `
    :host { all: initial; }
    .stack {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 360px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      background: #1e1e2e;
      color: #e6e6ef;
      border: 1px solid #6c5ce7;
      border-left: 4px solid #6c5ce7;
      border-radius: 6px;
      padding: 8px 10px;
      box-shadow: 0 6px 20px rgba(0,0,0,.35);
      cursor: pointer;
      font-size: 12px;
      line-height: 1.4;
      animation: slidein .18s ease-out;
      word-break: break-word;
    }
    .toast:hover { border-color: #a29bfe; }
    .toast .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 4px;
    }
    .toast .tag {
      background: #6c5ce7;
      color: #fff;
      border-radius: 3px;
      padding: 1px 6px;
      font-weight: 700;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    .toast .eid { color: #00d1a0; font-weight: 700; }
    .toast .hint { color: #7f7f99; font-size: 10px; }
    .toast .props {
      margin: 4px 0 0;
      padding: 6px 8px;
      background: #15151f;
      border-radius: 4px;
      max-height: 160px;
      overflow: auto;
      white-space: pre-wrap;
      color: #cbd5e1;
    }
    .toast.copied { border-color: #00d1a0; border-left-color: #00d1a0; }
    @keyframes slidein {
      from { transform: translateX(12px); opacity: 0; }
      to   { transform: translateX(0); opacity: 1; }
    }

    /* liquid glass theme — real refractive glass frosted over the live page.
       The page shows through (backdrop-filter blur), a diagonal specular sheen
       and a bright rim make it read as glass, and text stays dark for contrast
       on the typically light app pages it overlays. */
    .stack.glass .toast {
      background:
        linear-gradient(135deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.08) 32%, rgba(255,255,255,0.02) 58%),
        rgba(236, 238, 252, ${TOAST_GLASS_OPACITY});
      backdrop-filter: blur(10px) saturate(160%);
      -webkit-backdrop-filter: blur(10px) saturate(160%);
      border: 1px solid rgba(255, 255, 255, 0.45);
      border-radius: 16px;
      color: #12132e;
      text-shadow: 0 1px 0 rgba(255, 255, 255, 0.35);
      box-shadow:
        0 12px 34px rgba(0, 0, 0, 0.12),
        inset 0 1px 1px rgba(255, 255, 255, 0.45),
        inset 0 -8px 20px rgba(255, 255, 255, 0.08);
    }
    .stack.glass .toast:hover { border-color: rgba(255, 255, 255, 0.65); }
    .stack.glass .toast .tag {
      background: rgba(108, 92, 231, 0.85);
      color: #fff;
      text-shadow: none;
    }
    .stack.glass .toast .eid { color: #0a7a5c; }
    .stack.glass .toast .hint { color: rgba(18, 19, 46, 0.55); }
    .stack.glass .toast .props {
      background: rgba(255, 255, 255, 0.22);
      border: 1px solid rgba(255, 255, 255, 0.4);
      color: #14142b;
      text-shadow: none;
    }
    .stack.glass .toast.copied {
      border-color: #0a7a5c;
      box-shadow:
        0 12px 34px rgba(0, 0, 0, 0.12),
        inset 0 1px 1px rgba(255, 255, 255, 0.45),
        0 0 0 1px rgba(10, 122, 92, 0.5);
    }
  `;

  const ensureToastRoot = () => {
    if (toast.stack && toast.host && toast.host.isConnected) return;
    const host = document.createElement("div");
    host.id = "__eidsniffer-toasts";
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = TOAST_CSS;
    const stack = document.createElement("div");
    stack.className = config.theme === "glass" ? "stack glass" : "stack";
    root.appendChild(style);
    root.appendChild(stack);
    (document.body || document.documentElement).appendChild(host);
    toast.host = host;
    toast.root = root;
    toast.stack = stack;
  };

  const showToast = (tag, e) => {
    ensureToastRoot();
    const el = document.createElement("div");
    el.className = "toast";

    const top = document.createElement("div");
    top.className = "top";
    const left = document.createElement("span");
    const tagEl = document.createElement("span");
    tagEl.className = "tag";
    tagEl.textContent = `/${tag}`;
    const eidEl = document.createElement("span");
    eidEl.className = "eid";
    eidEl.textContent = " " + (e.eid ?? "(none)");
    left.appendChild(tagEl);
    left.appendChild(eidEl);
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "click to copy";
    top.appendChild(left);
    top.appendChild(hint);
    el.appendChild(top);

    const hasCustom = e.customProperties && Object.keys(e.customProperties).length > 0;
    if (hasCustom) {
      const props = document.createElement("pre");
      props.className = "props";
      props.textContent = JSON.stringify(e.customProperties, null, 2);
      el.appendChild(props);
    }

    let dismissTimer = null;
    const dismiss = () => {
      if (dismissTimer) clearTimeout(dismissTimer);
      el.remove();
    };
    dismissTimer = setTimeout(dismiss, config.popupTimeout * 1000);

    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const text =
        config.copyMode === "eid"
          ? e.eid ?? ""
          : JSON.stringify({ eid: e.eid, customProperties: e.customProperties ?? {} }, null, 2);
      const done = () => {
        el.classList.add("copied");
        hint.textContent = "copied!";
      };
      try {
        navigator.clipboard.writeText(text).then(done).catch(done);
      } catch (_) {
        done();
      }
      // Keep it around a moment longer after an intentional copy.
      if (dismissTimer) clearTimeout(dismissTimer);
      dismissTimer = setTimeout(dismiss, 1500);
    });

    toast.stack.insertBefore(el, toast.stack.firstChild);
    while (toast.stack.childElementCount > TOAST_MAX) {
      toast.stack.lastElementChild.remove();
    }
  };

  const teardownToasts = () => {
    if (toast.host && toast.host.isConnected) toast.host.remove();
    toast.host = null;
    toast.root = null;
    toast.stack = null;
  };

  /* ------------------------------------------------------------ dispatch -- */

  const handleEvents = (source, url, events) => {
    if (!events.length) return;
    const tag = getEndpointTag(url);
    const capturedAt = new Date().toISOString();
    for (const e of events) {
      state.events.push({ ...e, url, source, endpoint: tag, capturedAt });
      if (!shouldShow(tag)) continue;
      if (config.showConsole) logToConsole(tag, e);
      if (config.showToast) showToast(tag, e);
    }
  };

  const handlePayload = (source, url, rawBody) => {
    const payload = safeParse(rawBody);
    if (!payload) return;
    const events = extractEvents(payload);
    if (!events.length) return;
    handleEvents(source, url, events);
  };

  /* ------------------------------------------------------------- hooks ---- */

  window.fetch = async function patchedFetch(input, init) {
    let url = "";
    try {
      url = typeof input === "string" ? input : input?.url ?? "";
    } catch (_) {
      url = "";
    }

    if (COLLECT_URL_PATTERN.test(url)) {
      try {
        let body = init?.body;
        if (!body && input instanceof Request) {
          body = await input.clone().text();
        } else if (body instanceof Blob) {
          body = await body.text();
        } else if (body instanceof ArrayBuffer) {
          body = new TextDecoder().decode(body);
        } else if (body instanceof FormData) {
          const obj = {};
          body.forEach((v, k) => (obj[k] = v));
          body = JSON.stringify(obj);
        }
        handlePayload("fetch", url, body);
      } catch (err) {
        console.warn("[EID Sniffer] fetch parse failed", err);
      }
    }

    return originalFetch.apply(this, arguments);
  };

  OriginalXHR.prototype.open = function patchedOpen(method, url) {
    this.__eidSnifferUrl = url;
    return originalXHROpen.apply(this, arguments);
  };

  OriginalXHR.prototype.send = function patchedSend(body) {
    try {
      const url = this.__eidSnifferUrl ?? "";
      if (COLLECT_URL_PATTERN.test(url)) {
        if (body instanceof Blob) {
          body.text().then((t) => handlePayload("xhr", url, t)).catch(() => {});
        } else if (body instanceof ArrayBuffer) {
          handlePayload("xhr", url, new TextDecoder().decode(body));
        } else {
          handlePayload("xhr", url, body);
        }
      }
    } catch (err) {
      console.warn("[EID Sniffer] xhr parse failed", err);
    }
    return originalXHRSend.apply(this, arguments);
  };

  // sendBeacon is the most common transport for analytics — patch it too.
  const originalSendBeacon = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
  if (originalSendBeacon) {
    navigator.sendBeacon = function patchedSendBeacon(url, data) {
      try {
        if (COLLECT_URL_PATTERN.test(url || "")) {
          if (data instanceof Blob) {
            data.text().then((t) => handlePayload("beacon", url, t)).catch(() => {});
          } else if (data instanceof ArrayBuffer) {
            handlePayload("beacon", url, new TextDecoder().decode(data));
          } else if (data instanceof FormData) {
            const obj = {};
            data.forEach((v, k) => (obj[k] = v));
            handlePayload("beacon", url, JSON.stringify(obj));
          } else {
            handlePayload("beacon", url, data);
          }
        }
      } catch (err) {
        console.warn("[EID Sniffer] beacon parse failed", err);
      }
      return originalSendBeacon(url, data);
    };
  }

  /* --------------------------------------------------------- config wire -- */

  const applyConfig = (next) => {
    if (!next || typeof next !== "object") return;
    if (typeof next.trackCollect === "boolean") config.trackCollect = next.trackCollect;
    if (typeof next.trackWeb === "boolean") config.trackWeb = next.trackWeb;
    if (typeof next.showConsole === "boolean") config.showConsole = next.showConsole;
    if (typeof next.showToast === "boolean") config.showToast = next.showToast;
    if (POPUP_TIMEOUTS.includes(next.popupTimeout)) config.popupTimeout = next.popupTimeout;
    if (next.copyMode === "eid" || next.copyMode === "eidProps") config.copyMode = next.copyMode;
    if (next.theme === "glass" || next.theme === "dracula") config.theme = next.theme;
    if (toast.stack) toast.stack.className = config.theme === "glass" ? "stack glass" : "stack";
    if (!config.showToast) teardownToasts();
  };

  const onConfig = (ev) => applyConfig(ev.detail);
  document.addEventListener(CONFIG_EVENT, onConfig);

  /* ------------------------------------------------------------- control -- */

  window.__eidSniffer = {
    events: state.events,
    clear() {
      state.events.length = 0;
    },
    setVerbose(v) {
      state.verbose = !!v;
    },
    stop() {
      window.fetch = originalFetch;
      OriginalXHR.prototype.open = originalXHROpen;
      OriginalXHR.prototype.send = originalXHRSend;
      if (originalSendBeacon) navigator.sendBeacon = originalSendBeacon;
      document.removeEventListener(CONFIG_EVENT, onConfig);
      teardownToasts();
    },
  };

  // Ask the bridge to (re)send current config now that we're listening.
  try {
    document.dispatchEvent(new CustomEvent("__eidSnifferReady"));
  } catch (_) {
    /* ignore */
  }
})();
