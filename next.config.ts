import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @libsql/client/web is pure-JS over fetch; keep it external so the
  // bundler doesn't try to pull native bindings into the worker.
  serverExternalPackages: ["@libsql/client", "@libsql/isomorphic-ws"],
};

export default nextConfig;

// Enables getCloudflareContext()/bindings during `next dev`.
// No-op outside the Cloudflare adapter.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
