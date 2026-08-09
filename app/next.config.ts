import type { NextConfig } from "next";

const config: NextConfig = {
  // The worker package exports TypeScript source rather than a build output, so
  // there is no compile step to keep in sync between the two packages.
  transpilePackages: ["@firstknock/worker"],

  async redirects() {
    // The root belongs to the marketing landing page, which is Phase 6. Until
    // then the root sends signed in traffic to the today view rather than
    // occupying the slot with a placeholder.
    return [{ source: "/", destination: "/today", permanent: false }];
  },
};

export default config;
