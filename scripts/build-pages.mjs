// Builds the site as plain files in ./out for GitHub Pages.
//
// Pages serves static files only, so the files that need a server (API routes, the passcode page and the
// proxy) are moved aside for the build and always put back, even if the build fails or is interrupted.
//
//   npm run build:pages                              site at the domain root
//   PAGES_BASE_PATH=/Hannahs-Walks npm run build:pages    project page at /<repo>/
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stash = join(root, ".pages-stash");
const SERVER_ONLY = ["app/api", "app/unlock", "proxy.ts"];

const basePath = (process.env.PAGES_BASE_PATH ?? "").replace(/\/+$/, "");
if (basePath && !basePath.startsWith("/")) {
  console.error(`PAGES_BASE_PATH must start with "/" (got "${basePath}").`);
  process.exit(1);
}

if (existsSync(stash)) {
  console.error(".pages-stash already exists: a previous build was cut off. Move its files back, then delete it.");
  process.exit(1);
}

const moved = [];
function restore() {
  for (const rel of moved.splice(0).reverse()) {
    renameSync(join(stash, rel), join(root, rel));
  }
  rmSync(stash, { recursive: true, force: true });
}
process.on("exit", restore);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

for (const rel of SERVER_ONLY) {
  const from = join(root, rel);
  if (!existsSync(from)) continue;
  const to = join(stash, rel);
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
  moved.push(rel);
}

// A stale cache from the server build can carry route types for the files just set aside.
rmSync(join(root, ".next"), { recursive: true, force: true });
rmSync(join(root, "out"), { recursive: true, force: true });

const build = spawnSync("npx", ["next", "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_STATIC_SITE: "true", PAGES_BASE_PATH: basePath },
});
if (build.status !== 0) process.exit(build.status ?? 1);

// Without this file GitHub Pages would run the output through Jekyll, which drops the _next folder.
writeFileSync(join(root, "out", ".nojekyll"), "");
console.log(`\nStatic site written to out/${basePath ? ` for ${basePath}/` : ""}`);
