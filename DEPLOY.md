# Putting Stookii online (step-by-step)

This guide gets your app on the internet so your team can use it from any phone,
tablet, or computer. No coding — just clicking through a few screens. Total time:
about 30 minutes. If you get stuck, any developer can finish this in one sitting.

You'll use **Railway** — it's the easiest host that keeps your data safe on a
persistent disk (so nothing is lost when the app restarts). A small monthly cost
applies (usually ~$5).

---

## What you need first

1. A **GitHub** account — free — https://github.com/signup
2. A **Railway** account — free to start — https://railway.app (sign in with GitHub)

---

## Step 1 — Put the code on GitHub

1. Create a new **private** repository on GitHub (e.g. `stookii`).
2. Upload this whole project folder to it. (Easiest: install **GitHub Desktop**,
   "Add existing repository", pick this folder, then "Publish".)
   - The `.gitignore` already excludes the big/secret stuff.

## Step 2 — Deploy on Railway

1. Go to https://railway.app → **New Project** → **Deploy from GitHub repo**.
2. Pick your `stookii` repo. Railway sees the **Dockerfile** and builds it
   automatically — no settings to change.
3. Wait for the first build to finish (a few minutes).

## Step 3 — Add a persistent disk (IMPORTANT — keeps your data)

1. In your Railway service → **Settings** (or the **Volumes** tab) → **New Volume**.
2. Set the **Mount path** to exactly:  `/data`
3. Save. (This is where every store's products, orders and stock are kept.)

## Step 4 — Set your secrets

In the service → **Variables** → add these:

| Name            | Value                                                        |
|-----------------|--------------------------------------------------------------|
| `AUTH_SECRET`   | a long random string (see below)                             |
| `OWNER_PASSWORD`| the password you want for the **owner** login                |

To make a good `AUTH_SECRET`, run this once on any computer with Node, or just
mash a long random mix of letters/numbers (40+ characters):
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Railway will redeploy automatically after you add variables.

## Step 5 — Open it and sign in

1. In **Settings → Networking → Generate Domain**. You'll get a link like
   `https://stookii-production.up.railway.app`.
2. Open it on your phone. You'll see the **Stookii** login.
3. Sign in:  **username** `owner`  ·  **password** = whatever you set in `OWNER_PASSWORD`
   (or `sekuna2026` if you left it blank).
4. Go to **Stores & Users** to add your other shops and give each staff member a
   login. Go to **Store Settings** to fill in each store's details for its POs.

That's it — it's live. The **camera scanner works automatically** because the
Railway link is `https://` (phone cameras only work on secure links).

---

## Good to know

- **Your data is safe** on the `/data` volume across restarts and new deploys.
  To back it up, download the files in that volume from Railway occasionally.
- **Cost:** Railway bills for usage; a single-store app is typically a few
  dollars a month. You can set a spending limit in Railway.
- **Updating the app later:** push changes to GitHub and Railway redeploys itself.
- **Other hosts** (Render, Fly.io, or your own server) work too — they just need
  to run the `Dockerfile` with a persistent volume mounted at `/data` and the same
  two environment variables.

## Running it locally (optional, for testing)

```
npm install
npm run build
npm start        # opens on http://localhost:3200
```
Or with Docker:
```
docker build -t stookii .
docker run -p 3000:3000 -v stookii-data:/data -e AUTH_SECRET=test-secret stookii
```
