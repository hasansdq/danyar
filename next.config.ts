import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Dev-only: the sandbox preview panel serves the app behind a rewriting
  // proxy on *.space-z.ai domains — allow them so dev assets (/_next/*)
  // keep loading without cross-origin warnings.
  allowedDevOrigins: ["*.space-z.ai"],
  // SECURITY: production builds MUST pass TypeScript type-checking.
  // (Previously `ignoreBuildErrors: true` let type errors ship to prod.)
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // SECURITY: headers for user-uploaded files (served from /uploads).
  // Uploads are attacker-influenced content:
  //  - forced download (attachment) prevents inline HTML/SVG execution when
  //    opened directly in the browser tab,
  //  - sandbox CSP neutralizes scripts even if rendering is forced,
  //  - nosniff prevents MIME sniffing into executable types.
  // (<img>/<video> embeds in the app are unaffected by Content-Disposition.)
  async headers() {
    return [
      {
        source: "/uploads/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "default-src 'none'; sandbox" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Disposition", value: "attachment" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
