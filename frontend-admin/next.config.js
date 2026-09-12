/** @type {import('next').NextConfig} */
// Optional path-prefix build. The tenant-domain instance is built with
// NEXT_PUBLIC_ADMIN_BASE_PATH=/admin (+ its own ADMIN_DIST_DIR) so the whole
// admin app lives under `/admin/*` — routes AND `/_next/*` assets — letting
// nginx serve it at `marginx.in/admin` alongside the user app on `/` without
// the `_next` asset collision. Unset (admin.marginplant.com) → byte-identical
// to before.
const BASE_PATH = process.env.NEXT_PUBLIC_ADMIN_BASE_PATH || "";

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  ...(BASE_PATH ? { basePath: BASE_PATH } : {}),
  ...(process.env.ADMIN_DIST_DIR ? { distDir: process.env.ADMIN_DIST_DIR } : {}),
  images: { formats: ["image/avif", "image/webp"] },
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        // PWA "old code keeps showing" fix. The installed standalone
        // shell was serving stale HTML chunks because Chrome's HTTP
        // cache held onto them across opens (no service worker here
        // — pure manifest install). Force the HTML / route docs to
        // never cache; the underlying _next/static/* chunks keep
        // their long immutable cache because their filenames carry
        // a content hash.
        source: "/((?!_next/static|_next/image|api|.*\\.).*)",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
