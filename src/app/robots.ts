import type { MetadataRoute } from "next";
import { SITE } from "@/marketing/content";

/** The marketing pages are public. API routes and the signed-in app have nothing to index. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/app"] }], sitemap: `${SITE.origin}/sitemap.xml` };
}
