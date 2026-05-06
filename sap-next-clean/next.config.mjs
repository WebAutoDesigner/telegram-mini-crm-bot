/** @type {import('next').NextConfig} */
const isGithubPages = process.env.GITHUB_PAGES === "true";
const basePath = isGithubPages ? "/telegram-mini-crm-bot" : "";

const nextConfig = {
  trailingSlash: true,
  output: isGithubPages ? "export" : "standalone",
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined
};

export default nextConfig;
