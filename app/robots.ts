import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api/*"],
      },
      {
        userAgent: ["Bytespider", "CCBot", "ClaudeBot", "GPTBot", "anthropic-ai"],
        disallow: ["/"],
      },
    ],
    sitemap: "https://apex-esports.in/sitemap.xml",
  };
}
