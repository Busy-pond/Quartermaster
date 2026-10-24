/**
 * Runs the Postman collection with newman against the built app and a mocked PayPal:  npm run test:api
 * Needs a build first (`npm run test:e2e -- --build-only`). Starts and stops both servers itself.
 */
import { spawn, spawnSync } from "node:child_process";
import { APP_PORT, MOCK_PAYPAL_PORT, e2eEnv } from "./e2e-env.mjs";

const env = e2eEnv();
// Each server gets its own process group (detached), so stop() can end the shell wrapper AND the real
// server under it. Killing only the wrapper left the mock PayPal running in CI, and the Playwright step
// that follows then found its port taken.
const isWin = process.platform === "win32";
const start = (cmd, args) => spawn(cmd, args, { env, stdio: "inherit", shell: true, detached: !isWin });
const servers = [start("node", ["scripts/mock-paypal.mjs"]), start("npx", ["next", "start", "-p", String(APP_PORT)])];

function stop() {
  for (const s of servers) {
    if (isWin) spawnSync("taskkill", ["/F", "/T", "/PID", String(s.pid)], { stdio: "ignore" });
    else {
      try {
        process.kill(-s.pid, "SIGTERM"); // the whole group
      } catch {
        /* already gone */
      }
    }
  }
}

async function waitFor(url, seconds) {
  for (let i = 0; i < seconds; i++) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

let code = 1;
try {
  if (!(await waitFor(`http://localhost:${APP_PORT}/api/health`, 90)) || !(await waitFor(`http://localhost:${MOCK_PAYPAL_PORT}/health`, 10))) {
    console.error("The app or the mock PayPal did not start in time.");
  } else {
    code =
      spawnSync(
        "npx",
        ["--yes", "newman@6.2.1", "run", "postman/quartermaster.postman_collection.json", "-e", "postman/quartermaster-sandbox.postman_environment.json", "--env-var", `baseUrl=http://localhost:${APP_PORT}`],
        { env, stdio: "inherit", shell: true },
      ).status ?? 1;
  }
} finally {
  stop();
}
process.exit(code);
