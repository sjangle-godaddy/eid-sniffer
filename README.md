# EID Sniffer

A Chrome extension that captures the `eid` and `customProperties` of events fired to the SST `/csp/collect` and `/eventbus/web` endpoints, and shows them in the console and/or as on-page toasts.

It replaces the old workflow of checking the network tab results or pasting a script into DevTools.

Features:
- Shows EID with custom properties as toast notification as well as logs to console.

<img width="800" height="605" alt="eid_sniffer_demo" src="https://github.com/user-attachments/assets/795177d9-322f-4fa5-8250-5e7a8959ba15" />


## Install

1. Clone this repo (or download it as a ZIP and unzip).
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).

The purple **EID** icon appears in the toolbar.

## Use

1. Click the icon to open the popup.
2. Toggle **Activate** on.
  It auto-triggers for whitelisted domains (defaults: `*.godaddy.com`, `*.test-godaddy.com`).
3. Choose what to track `/eventbus/web` (default) and how to see it (Console, On-page toast, or both).
4. Reload the target page so the sniffer gets applied to page.

## Updating

This is an unpacked extension, so updating is same as installing. No Chrome Web Store listing is needed for internal use.

- Do `git pull` locally, then open `chrome://extensions` in chrome and click the reload icon on the EID Sniffer extension.

