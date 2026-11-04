import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright-core", "linkedom", "exceljs"],
};

export default nextConfig;
