import type { NextConfig } from "next";
import { execSync } from "node:child_process";

// Resolve the current git commit at build time so the footer can show it.
// Cloudflare Workers Builds exposes the commit via CF_PAGES_COMMIT_SHA /
// WORKERS_CI_COMMIT_SHA; fall back to `git` locally.
function gitCommit(): string {
  const fromCI =
    process.env.CF_PAGES_COMMIT_SHA ||
    process.env.WORKERS_CI_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA;
  if (fromCI) return fromCI.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

// Last deploy time ≈ build time. Format it here (Node has full ICU) so the
// inlined value is the final KST display string — the client just prints it,
// avoiding any runtime Intl/timezone differences between server and browser.
function buildTime(): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

const nextConfig: NextConfig = {
  // @libsql/client/web is pure-JS over fetch; keep it external so the
  // bundler doesn't try to pull native bindings into the worker.
  serverExternalPackages: ["@libsql/client", "@libsql/isomorphic-ws"],
  // Inlined into the client bundle at build time.
  env: {
    NEXT_PUBLIC_GIT_COMMIT: gitCommit(),
    // KST display string for the last deploy time (a build runs on each deploy).
    NEXT_PUBLIC_BUILD_TIME: buildTime(),
  },
};

export default nextConfig;

// Enables getCloudflareContext()/bindings during `next dev`.
// No-op outside the Cloudflare adapter.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
