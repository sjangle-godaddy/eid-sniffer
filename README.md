# EID Sniffer

A Chrome extension that captures the `eid` and `customProperties` of events fired to the SST `/csp/collect` and `/eventbus/web` endpoints, and shows them in the console and/or as on-page toasts.

It replaces the old workflow of checking the network tab results or pasting a script into DevTools.

<img width="800" height="526" alt="eid_gif_demo" src="https://github.com/user-attachments/assets/bcd1cc11-7195-49a6-a43c-f73983d77367" />


## Install

1. Clone this repo (or download it as a ZIP and unzip).
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).

The purple **EID** icon appears in the toolbar.

## Use

1. Click the icon to open the popup.
2. Toggle **Activate** on.
  It auto-triggers for whitelisted domains (defaults: `*.godaddy.com`, `*.test-godaddy.com`).
3. Choose what to track (`/csp/collect`, `/eventbus/web`) and how to see it (Console, On-page toast, or both).
4. Reload the target page so the sniffer hooks requests from the start.

Toasts show `eid` + `customProperties`; click one to copy (EID only, or EID + custom properties, per the popup setting).
In the console, `window.__eidSniffer.events` holds everything captured and `__eidSniffer.stop()` disables the hooks.

Add or remove domains via **Edit domain whitelist** in the popup; custom domains prompt for permission.

## Updating

This is an unpacked extension, so updating is same as installing.

- **Updating:** they `git pull`, then click the reload icon on the extension card in `chrome://extensions`.

No Chrome Web Store listing is needed for internal use.
