/**
 * EID Sniffer — background service worker.
 *
 * Owns the "am I active and where" decision. Based on the persisted `active`
 * flag and `whitelist`, it registers (or removes) the MAIN-world sniffer and the
 * ISOLATED-world config bridge as document_start content scripts, injects them
 * into already-open matching tabs on activation, tears them down on
 * deactivation, and keeps the toolbar badge in sync.
 */

const SNIFFER_ID = "eid-sniffer-main";
const BRIDGE_ID = "eid-sniffer-bridge";
const SNIFFER_FILE = "src/sniffer.js";
const BRIDGE_FILE = "src/bridge.js";

const DEFAULT_WHITELIST = ["*://*.godaddy.com/*", "*://*.test-godaddy.com/*"];

const DEFAULTS = {
  active: false,
  trackCollect: false,
  trackWeb: true,
  showConsole: true,
  showToast: false,
  copyMode: "eidProps",
  theme: "glass",
  whitelist: DEFAULT_WHITELIST,
};

const getState = () =>
  new Promise((resolve) => {
    chrome.storage.local.get(DEFAULTS, (stored) => resolve({ ...DEFAULTS, ...stored }));
  });

/** Keep only the match patterns we actually hold host permission for. */
async function allowedMatches(patterns) {
  const list = Array.isArray(patterns) ? patterns.filter(Boolean) : [];
  const checks = await Promise.all(
    list.map(
      (origin) =>
        new Promise((resolve) => {
          try {
            chrome.permissions.contains({ origins: [origin] }, (has) =>
              resolve(has && !chrome.runtime.lastError ? origin : null)
            );
          } catch (_) {
            resolve(null);
          }
        })
    )
  );
  return checks.filter(Boolean);
}

async function unregister() {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [SNIFFER_ID, BRIDGE_ID],
    });
    if (existing.length) {
      await chrome.scripting.unregisterContentScripts({
        ids: existing.map((s) => s.id),
      });
    }
  } catch (_) {
    /* nothing registered */
  }
}

async function register(matches) {
  await chrome.scripting.registerContentScripts([
    {
      id: SNIFFER_ID,
      js: [SNIFFER_FILE],
      matches,
      runAt: "document_start",
      world: "MAIN",
      allFrames: false,
      persistAcrossSessions: false,
    },
    {
      id: BRIDGE_ID,
      js: [BRIDGE_FILE],
      matches,
      runAt: "document_start",
      world: "ISOLATED",
      allFrames: false,
      persistAcrossSessions: false,
    },
  ]);
}

/** Run a per-tab action against every open tab matching the given patterns. */
async function forEachMatchingTab(patterns, fn) {
  for (const pattern of patterns) {
    let tabs = [];
    try {
      tabs = await chrome.tabs.query({ url: pattern });
    } catch (_) {
      continue;
    }
    for (const tab of tabs) {
      if (tab.id == null) continue;
      try {
        await fn(tab);
      } catch (_) {
        /* restricted tab (chrome://, store, etc.) — skip */
      }
    }
  }
}

async function injectOpenTabs(matches) {
  await forEachMatchingTab(matches, async (tab) => {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      files: [SNIFFER_FILE],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      files: [BRIDGE_FILE],
    });
  });
}

async function teardownOpenTabs(matches) {
  await forEachMatchingTab(matches, async (tab) => {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: () => {
        if (window.__eidSniffer && typeof window.__eidSniffer.stop === "function") {
          window.__eidSniffer.stop();
        }
      },
    });
  });
}

function setBadge(active) {
  try {
    chrome.action.setBadgeText({ text: active ? "ON" : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#6c5ce7" });
  } catch (_) {
    /* ignore */
  }
}

/** Bring registered scripts + open tabs in line with persisted state. */
async function reconcile() {
  const { active, whitelist } = await getState();
  setBadge(active);

  await unregister();

  if (!active) {
    await teardownOpenTabs(whitelist);
    return;
  }

  const matches = await allowedMatches(whitelist);
  if (!matches.length) return;

  await register(matches);
  await injectOpenTabs(matches);
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await getState();
  // Seed any missing defaults without clobbering existing choices.
  await chrome.storage.local.set(stored);
  reconcile();
});

chrome.runtime.onStartup.addListener(reconcile);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  // active/whitelist change what/where we inject; track/style are handled live
  // by the bridge, so they don't require re-registration.
  if (changes.active || changes.whitelist) {
    reconcile();
  }
});
