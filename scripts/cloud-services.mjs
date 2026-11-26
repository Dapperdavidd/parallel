/**
 * Run the always-on pieces that share Parallel's key-bearing environment.
 *
 * The cloud host exposes the signer's /health endpoint on PORT while the keeper runs
 * beside it. If either process dies, this supervisor exits so the platform
 * restarts the whole unit instead of leaving a half-healthy deployment.
 */

import { spawn } from "node:child_process";

const tsx = "./node_modules/.bin/tsx";
const port = process.env.PORT ?? process.env.PARALLEL_SIGNER_PORT ?? "8787";
const shared = {
  ...process.env,
  PARALLEL_SIGNER_HOST: process.env.PARALLEL_SIGNER_HOST ?? "0.0.0.0",
  PARALLEL_SIGNER_PORT: port,
};

const children = [
  spawn(process.execPath, [tsx, "src/services/signer.ts", `--port=${port}`], {
    env: shared,
    stdio: "inherit",
  }),
  spawn(process.execPath, [tsx, "src/services/keeper.ts", "--loop"], {
    env: shared,
    stdio: "inherit",
  }),
];

let stopping = false;

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal));
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(`cloud service failed to start: ${error.message}`);
    stop();
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`cloud service exited unexpectedly (${signal ?? code ?? "unknown"})`);
    stop();
    process.exitCode = code && code !== 0 ? code : 1;
  });
}

await Promise.all(children.map((child) => new Promise((resolve) => child.once("exit", resolve))));
process.exit(process.exitCode ?? 0);
