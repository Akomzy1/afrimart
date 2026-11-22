/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.AFRIMART_NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@afrimart/ui", "@afrimart/api-client", "@afrimart/shared"],
};

export default nextConfig;
