/**
 * EID Sniffer — ISOLATED-world config bridge.
 *
 * Content scripts run in an isolated world with access to `chrome.storage`, but
 * the sniffer hooks must run in the page's MAIN world (which has no extension
 * API access). This bridge reads the tracking config from storage and relays it
 * to the MAIN-world sniffer via a `__eidSnifferConfig` CustomEvent, then keeps
 * it in sync as the user changes options.
 */
(() => {
  const CONFIG_EVENT = "__eidSnifferConfig";
  const READY_EVENT = "__eidSnifferReady";

  const DEFAULTS = {
    trackCollect: false,
    trackWeb: true,
    showConsole: true,
    showToast: false,
    copyMode: "eidProps",
  };

  const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);

  const pickConfig = (stored) => ({
    trackCollect: bool(stored?.trackCollect, DEFAULTS.trackCollect),
    trackWeb: bool(stored?.trackWeb, DEFAULTS.trackWeb),
    showConsole: bool(stored?.showConsole, DEFAULTS.showConsole),
    showToast: bool(stored?.showToast, DEFAULTS.showToast),
    copyMode: stored?.copyMode === "eid" ? "eid" : DEFAULTS.copyMode,
  });

  const dispatch = (config) => {
    try {
      document.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail: config }));
    } catch (_) {
      /* ignore */
    }
  };

  const pushCurrent = () => {
    try {
      chrome.storage.local.get(["trackCollect", "trackWeb", "showConsole", "showToast", "copyMode"], (stored) => {
        dispatch(pickConfig(stored));
      });
    } catch (_) {
      dispatch(DEFAULTS);
    }
  };

  // The sniffer announces itself once its config listener is attached, so we
  // (re)send in response — this closes the race between the two document_start
  // scripts regardless of which runs first.
  document.addEventListener(READY_EVENT, pushCurrent);

  // Push once now in case the sniffer was already listening.
  pushCurrent();

  // Keep the MAIN world in sync with live option changes.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (
        changes.trackCollect ||
        changes.trackWeb ||
        changes.showConsole ||
        changes.showToast ||
        changes.copyMode
      ) {
        pushCurrent();
      }
    });
  } catch (_) {
    /* ignore */
  }
})();
