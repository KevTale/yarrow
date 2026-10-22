import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No ISR in this scaffold; no R2 account or bucket is required for local builds.
export default defineCloudflareConfig({});
