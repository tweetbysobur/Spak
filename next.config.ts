import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // The Tidepool testnet build goes to its own folder, so it can never be served as the mainnet build by mistake.
  distDir: process.env.NEXT_PUBLIC_SPAK_NETWORK_ENV === "tidepool-testnet" ? ".next-testnet" : ".next",
  // Native/WASM database drivers run as plain Node modules, not bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // The Product and How it works pages were folded into the homepage. Old links keep working.
  async redirects() {
    return [
      { source: "/product", destination: "/#capabilities", permanent: false },
      { source: "/how-it-works", destination: "/#how-it-works", permanent: false },
    ];
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
