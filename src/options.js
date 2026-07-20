/**
 * Options page — manage the auto-inject domain whitelist.
 *
 * Custom (non-default) patterns require optional host permission, which we
 * request on a user gesture before persisting. The background worker re-registers
 * content scripts whenever `whitelist` changes.
 */
const DEFAULT_WHITELIST = ["*://*.godaddy.com/*", "*://*.test-godaddy.com/*"];

const els = {
  list: document.getElementById("list"),
  form: document.getElementById("addForm"),
  input: document.getElementById("patternInput"),
  msg: document.getElementById("msg"),
  reset: document.getElementById("reset"),
};

// Match pattern: <scheme>://<host><path>, e.g. *://*.example.com/*
const PATTERN_RE = /^(\*|https?|file|ftp):\/\/(\*|(?:\*\.)?[^/*]+|)(\/.*)$/;

const isDefault = (p) => DEFAULT_WHITELIST.includes(p);

function setMsg(text, kind) {
  els.msg.textContent = text || "";
  els.msg.className = "msg" + (kind ? " " + kind : "");
}

function getWhitelist() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ whitelist: DEFAULT_WHITELIST }, (s) => {
      const list = Array.isArray(s.whitelist) && s.whitelist.length ? s.whitelist : DEFAULT_WHITELIST;
      resolve(list);
    });
  });
}

function saveWhitelist(list) {
  return new Promise((resolve) => chrome.storage.local.set({ whitelist: list }, resolve));
}

async function render() {
  const list = await getWhitelist();
  els.list.innerHTML = "";
  for (const pattern of list) {
    const li = document.createElement("li");
    li.className = "item";

    const left = document.createElement("div");
    const code = document.createElement("code");
    code.textContent = pattern;
    left.appendChild(code);
    if (isDefault(pattern)) {
      const tag = document.createElement("span");
      tag.className = "default-tag";
      tag.textContent = "default";
      left.appendChild(tag);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => removePattern(pattern));

    li.appendChild(left);
    li.appendChild(remove);
    els.list.appendChild(li);
  }
}

function requestPermission(pattern) {
  return new Promise((resolve) => {
    try {
      chrome.permissions.request({ origins: [pattern] }, (granted) =>
        resolve(granted && !chrome.runtime.lastError)
      );
    } catch (_) {
      resolve(false);
    }
  });
}

function removePermission(pattern) {
  return new Promise((resolve) => {
    try {
      chrome.permissions.remove({ origins: [pattern] }, () => resolve());
    } catch (_) {
      resolve();
    }
  });
}

async function addPattern(pattern) {
  if (!PATTERN_RE.test(pattern)) {
    setMsg("Not a valid match pattern (e.g. *://*.example.com/*).", "error");
    return;
  }
  const list = await getWhitelist();
  if (list.includes(pattern)) {
    setMsg("That pattern is already in the list.", "error");
    return;
  }
  const granted = await requestPermission(pattern);
  if (!granted) {
    setMsg("Permission for that domain was not granted.", "error");
    return;
  }
  await saveWhitelist([...list, pattern]);
  els.input.value = "";
  setMsg("Added.", "ok");
  render();
}

async function removePattern(pattern) {
  const list = await getWhitelist();
  const next = list.filter((p) => p !== pattern);
  await saveWhitelist(next);
  if (!isDefault(pattern)) await removePermission(pattern);
  setMsg("Removed.", "ok");
  render();
}

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  addPattern(els.input.value.trim());
});

els.reset.addEventListener("click", async () => {
  await saveWhitelist(DEFAULT_WHITELIST);
  setMsg("Reset to defaults.", "ok");
  render();
});

render();
