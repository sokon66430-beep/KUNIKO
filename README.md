# ON Mart till app — download

The companion app for the SUNMI T3 register. It exists so the till can reach
the built-in printer and the cash drawer, which a browser cannot.

**Download:**
https://raw.githubusercontent.com/sokon66430-beep/KUNIKO/onmart-till-apk/onmart-pos.apk

Open that link **on the T3 itself**, then:

1. Open the downloaded file.
2. The first time, Android asks to allow installing apps from the browser —
   tap **Settings**, turn it on, then press back.
3. If Google Play Protect says *App blocked to protect your device*, tap
   **More details**, then **Install anyway**. It says that about every app not
   installed from the Play Store; it means Google has not seen this publisher
   before, not that anything is wrong with the app.
4. Tap **Install**, then open **ON Mart POS** and sign in.

Installing a newer version over an older one keeps the till signed in and
keeps any sales still waiting to sync.

## Checking the printer

Once installed, open the account menu (top right) and tap **Test printer**.
It prints a short slip down the same path a customer receipt takes, so if
that slip comes out, receipts will too. If it does not, the till now says
why — out of paper, cover open, or the printer service not being reachable
on this device.

## This build

Built from `1cf9fde`, 1 August 2026.

Printing:

- A receipt can no longer be lost between the print queue and the printer
  connection — the fault that let a sale finish with no paper and no error.
- Printer problems are announced on screen instead of only in a log.
- A receipt still unprinted after 8 seconds says so, while the customer is
  still at the counter.
- Out of paper, cover open and cutter jams are reported in words.
- **Test printer** in the till menu, available to floor staff too.

How the slip reads:

- Each item prints its Khmer name large with the English small underneath —
  both names, as the law asks, but as one item rather than two lines of
  equal weight. A product with only an English name prints just that.
- The three cancellation rows — Cancelled, Approved by, Reason — each fit
  one line instead of wrapping.

Reinstalling matters for this one: the sizes above are drawn by the app, so
they only change on the paper once this build is on the till. Everything
else in the POS updates by itself.

---

This branch holds the built APK and nothing else — no source. It is a
download location, deliberately separate from `main` so that nothing here
touches what Render deploys from this repository.

The same APK is always served from the POS itself at
https://onmart-pos.onrender.com/install
