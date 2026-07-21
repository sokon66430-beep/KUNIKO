# Stookii Printer — Sunmi companion app

A thin Android wrapper that runs Stookii (https://stookii-me.onrender.com) in a
full-screen WebView **and gives it access to the Sunmi built-in thermal printer +
cash drawer**, which a normal browser cannot reach.

The web app calls a JavaScript bridge that this app injects:

```js
window.StookiiPrinter.printReceipt(jsonString) // prints an 80mm receipt
window.StookiiPrinter.openDrawer()             // pops the cash drawer
window.StookiiPrinter.version()                // "1"
```

Stookii already builds the JSON and calls this bridge automatically when a sale
completes (see `src/lib/printer.ts`). So once this app is installed and opened on
the Sunmi, receipts print with no extra steps.

## How the receipt printing works

- Binds to Sunmi's inner-printer AIDL service `woyou.aidlservice.jiuiv5.IWoyouService`
  (present on every Sunmi with a built-in printer — no external SDK needed).
- Renders the JSON receipt with centred header, item lines, totals and a footer,
  cuts the paper, and opens the drawer for cash sales.

## Build the APK (no local Android setup needed)

Pushing this folder to GitHub triggers **`.github/workflows/sunmi-apk.yml`**, which
builds a debug APK in the cloud and uploads it as a downloadable artifact
("stookii-printer-apk"). Download it from the Actions run.

Or build locally with Android Studio / `gradle assembleDebug` (needs the Android SDK).

## Install on the Sunmi

1. Copy the `app-debug.apk` to the Sunmi (USB, or download from GitHub Actions in
   the Sunmi's browser).
2. Open the file → allow "install from unknown sources" if asked → Install.
3. Open **Stookii Printer**. It loads the till full-screen. Log in and use Till Mode
   as normal; receipts now print on the built-in printer.

## Change the URL

Edit `WEB_URL` in `app/src/main/java/me/stookii/printer/MainActivity.kt`.
