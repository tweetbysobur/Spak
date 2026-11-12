import type { MetadataRoute } from "next";
import { SITE } from "@/marketing/content";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/product", "/how-it-works", "/developers", "/docs"].map((path) => ({ url: `${SITE.origin}${path}`, changeFrequency: "weekly", priority: path === "/" ? 1 : 0.7 }));
}
