/**
 * Popup controls. Reads/writes the persisted config; the background worker and
 * the bridge react to storage changes, so the popup only needs to store state.
 */
const DEFAULTS = {
  active: false,
  trackCollect: false,
  trackWeb: true,
  showConsole: true,
  showToast: true,
  copyMode: "eid",
  theme: "glass",
};

const els = {
  active: document.getElementById("active"),
  trackCollect: document.getElementById("trackCollect"),
  trackWeb: document.getElementById("trackWeb"),
  styleConsole: document.getElementById("styleConsole"),
  styleToast: document.getElementById("styleToast"),
  copyMode: document.getElementById("copyMode"),
  theme: document.getElementById("theme"),
  status: document.getElementById("status"),
  openOptions: document.getElementById("openOptions"),
};

function render(state) {
  els.active.checked = state.active;
  els.trackCollect.checked = state.trackCollect;
  els.trackWeb.checked = state.trackWeb;
  els.styleConsole.checked = state.showConsole;
  els.styleToast.checked = state.showToast;
  els.copyMode.value = state.copyMode === "eid" ? "eid" : "eidProps";
  els.copyMode.disabled = !state.showToast;
  els.theme.value = state.theme === "dracula" ? "dracula" : "glass";
  document.body.classList.toggle("theme-glass", state.theme !== "dracula");

  els.status.textContent = state.active ? "Active" : "Inactive";
  els.status.classList.toggle("status--on", state.active);
  els.status.classList.toggle("status--off", !state.active);
}

function save(patch) {
  chrome.storage.local.set(patch);
}

chrome.storage.local.get(DEFAULTS, (stored) => {
  render({ ...DEFAULTS, ...stored });
});

els.active.addEventListener("change", () => {
  save({ active: els.active.checked });
  els.status.textContent = els.active.checked ? "Active" : "Inactive";
  els.status.classList.toggle("status--on", els.active.checked);
  els.status.classList.toggle("status--off", !els.active.checked);
});

els.trackCollect.addEventListener("change", () => save({ trackCollect: els.trackCollect.checked }));
els.trackWeb.addEventListener("change", () => save({ trackWeb: els.trackWeb.checked }));
els.styleConsole.addEventListener("change", () => save({ showConsole: els.styleConsole.checked }));
els.styleToast.addEventListener("change", () => {
  save({ showToast: els.styleToast.checked });
  els.copyMode.disabled = !els.styleToast.checked;
});
els.copyMode.addEventListener("change", () => save({ copyMode: els.copyMode.value }));
els.theme.addEventListener("change", () => {
  save({ theme: els.theme.value });
  document.body.classList.toggle("theme-glass", els.theme.value !== "dracula");
});

els.openOptions.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
