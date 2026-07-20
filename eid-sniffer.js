/**
 * EID Sniffer — paste this whole script into the Chrome DevTools Console
 * on any page that fires events to the SST collect endpoint.
 *
 * It intercepts both `fetch` and `XMLHttpRequest` calls to:
 *   - https://g.sst.test-godaddy.com/csp/collect
 *   - https://g.sst.godaddy.com/csp/collect
 *
 * For every event in the payload it prints:
 *   - eid
 *   - customProperties
 *
 * Re-pasting the script is safe; it will replace the previous hook.
 *
 * Controls (after pasting):
 *   __eidSniffer.stop()        // restore original fetch/XHR
 *   __eidSniffer.events        // array of every captured { eid, customProperties, ... }
 *   __eidSniffer.clear()       // empty the captured events array
 *   __eidSniffer.setVerbose(b) // toggle full-payload logging
 *
 * Flags (edit below before pasting):
 *   showCollect // print events seen on the /csp/collect endpoint
 *   showWeb     // print events seen on the /eventbus/web endpoint
 */
(() => {
  // Flip these to control which endpoint's logs get printed to the console.
  // (Events are still captured into __eidSniffer.events regardless of these flags.)
  const showCollect = false;
  const showWeb = true;

  // Legacy TCC collect endpoint (prod) OR the newer Signals eventbus endpoint (test/local).
  const COLLECT_PATTERN = /\/csp\/collect(?:[?/]|$)/;
  const WEB_PATTERN = /\/eventbus\/web(?:[?/]|$)/;
  const COLLECT_URL_PATTERN = /(?:\/csp\/collect|\/eventbus\/web)(?:[?/]|$)/;

  if (window.__eidSniffer && typeof window.__eidSniffer.stop === "function") {
    try {
      window.__eidSniffer.stop();
      console.log("%c[EID Sniffer] Replacing previous hook…", "color:#888");
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

  const styles = {
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

  const shouldLog = (tag) => {
    if (tag === "collect") return showCollect;
    if (tag === "web") return showWeb;
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

  const logEvents = (source, url, events) => {
    if (!events.length) return;
    const tag = getEndpointTag(url);
    if (!shouldLog(tag)) return;
    const label = `[EID /${tag}]`;
    for (const e of events) {
      console.log(`%c${label}%c eid: ${e.eid ?? "(none)"}`, styles.header, styles.eid);
      const hasCustom = e.customProperties && Object.keys(e.customProperties).length > 0;
      console.log(
        `%c${label}%c customProperties: %c${hasCustom ? JSON.stringify(e.customProperties) : "{}"}`,
        styles.header,
        styles.label,
        hasCustom ? "color:inherit" : styles.empty
      );
      if (state.verbose) {
        console.log(`%c${label}%c full:`, styles.header, styles.label, e);
      }
    }
  };

  const handlePayload = (source, url, rawBody) => {
    const payload = safeParse(rawBody);
    if (!payload) return;
    const events = extractEvents(payload);
    if (!events.length) return;
    const endpoint = getEndpointTag(url);
    state.events.push(...events.map((e) => ({ ...e, url, source, endpoint, capturedAt: new Date().toISOString() })));
    logEvents(source, url, events);
  };

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
        let parsed = body;
        if (parsed instanceof Blob) {
          parsed.text().then((t) => handlePayload("xhr", url, t)).catch(() => {});
        } else if (parsed instanceof ArrayBuffer) {
          handlePayload("xhr", url, new TextDecoder().decode(parsed));
        } else {
          handlePayload("xhr", url, parsed);
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

  window.__eidSniffer = {
    events: state.events,
    clear() {
      state.events.length = 0;
      console.log("%c[EID Sniffer] cleared", styles.label);
    },
    setVerbose(v) {
      state.verbose = !!v;
      console.log(`%c[EID Sniffer] verbose = ${state.verbose}`, styles.label);
    },
    stop() {
      window.fetch = originalFetch;
      OriginalXHR.prototype.open = originalXHROpen;
      OriginalXHR.prototype.send = originalXHRSend;
      if (originalSendBeacon) navigator.sendBeacon = originalSendBeacon;
      console.log("%c[EID Sniffer] stopped — originals restored", styles.label);
    },
  };

  console.log(
    `%c[EID Sniffer] active%c — listening for /csp/collect and /eventbus/web (fetch / XHR / sendBeacon).\nshowCollect=${showCollect}, showWeb=${showWeb} (edit the flags at the top of the script to change).\nUse __eidSniffer.events, .clear(), .setVerbose(true), .stop().`,
    styles.header,
    "color:inherit"
  );
})();
