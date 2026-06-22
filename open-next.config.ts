import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // Incremental cache, tag cache, queue, etc. can be wired to KV/D1/R2 here.
  // Defaults are fine for this app (no ISR/on-demand revalidation in use).
});
