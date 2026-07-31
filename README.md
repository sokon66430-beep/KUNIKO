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

---

This branch holds the built APK and nothing else — no source. It is a
download location, deliberately separate from `main` so that nothing here
touches what Render deploys from this repository.

The same APK is always served from the POS itself at
https://onmart-pos.onrender.com/install
