/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produce a self-contained server bundle for a small, fast Docker image.
  output: "standalone",
};

module.exports = nextConfig;
