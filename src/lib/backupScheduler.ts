import { saveDailyBackup } from "./backup";

// Runs a daily on-disk backup from inside the long-running server. Checks hourly
// and writes at most ONE backup per calendar day (it skips if today's file
// already exists), so it survives restarts/redeploys and never doubles up.
let started = false;

export function startBackupScheduler(): void {
  if (started) return;
  started = true;

  const run = () => {
    saveDailyBackup(new Date())
      .then((r) => {
        if (r.saved) console.log(`[backup] daily backup written: ${r.file}`);
        else if (r.error) console.error(`[backup] daily backup failed: ${r.error}`);
      })
      .catch((e) => console.error("[backup] scheduler error", e));
  };

  // First pass shortly after boot (so a fresh deploy is backed up), then hourly.
  setTimeout(run, 30_000);
  setInterval(run, 60 * 60 * 1000);
}
