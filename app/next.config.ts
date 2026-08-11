import type { NextConfig } from "next";

const config: NextConfig = {
  // The worker package exports TypeScript source rather than a build output, so
  // there is no compile step to keep in sync between the two packages.
  transpilePackages: ["@firstknock/worker"],

};

export default config;
