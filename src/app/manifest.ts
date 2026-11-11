import type { MetadataRoute } from "next";
import colors from "@/design/colors.json";

/** Web app manifest from the approved icons and colour tokens. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SPak",
    short_name: "SPak",
    description: "Intelligent execution across chains.",
    start_url: "/app",
    display: "standalone",
    background_color: colors.themes.light.background,
    theme_color: colors.brand.forestGreen,
    icons: [
      { src: "/brand/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/brand/icons/favicon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
