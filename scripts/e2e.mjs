/**
 * Builds the app against a mocked PayPal and a scripted AI model, then runs the Playwright tests:  npm run test:e2e
 *   --build-only   build and stop (CI builds once, then runs newman and Playwright)
 *   --skip-build   reuse the last build
 * Anything else is passed to `playwright test`. See scripts/e2e-env.mjs for the database rules.
 */
import { spawnSync } from "node:child_process";
import { e2eEnv } from "./e2e-env.mjs";

const env = e2eEnv();
const args = process.argv.slice(2);
const buildOnly = args.includes("--build-only");
const skipBuild = args.includes("--skip-build");
const rest = args.filter((a) => a !== "--build-only" && a !== "--skip-build");

function run(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { env, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!skipBuild) run("npm", ["run", "build"]);
if (!buildOnly) run("npx", ["playwright", "test", ...rest]);
