/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /* the rule engine and services are CommonJS on purpose: the same file
     is required by the crons, the route handlers and the tests */
  serverExternalPackages: [],
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "no-store" }
    ] }];
  },
  async redirects() {
    /* old hash routes from the single-file HUD */
    return [];
  }
};
export default nextConfig;
