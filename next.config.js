/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (.next/standalone) for slim production images.
  output: "standalone",
  experimental: {
    // pdfkit ships its own fonts via .afm files; keep it external to the bundle
    serverComponentsExternalPackages: ["pdfkit", "ioredis"],
  },
  async headers() {
    const isDev = process.env.NODE_ENV !== "production";
    // Production CSP is strict; dev additionally allows eval + the HMR websocket that
    // Next.js Fast Refresh needs. data:/blob: cover inline QR codes and image previews.
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      `connect-src 'self'${isDev ? " ws:" : ""}`,
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
