import type { Metadata } from "next";
import "./marketing.css";
import { OG_IMAGE, SITE } from "@/marketing/content";
import { Reveal } from "@/components/marketing/Reveal";
import { SiteFooter, SiteNav } from "@/components/marketing/site";

const title = `${SITE.name}: ${SITE.tagline}`;
export const metadata: Metadata = {
  metadataBase: new URL(SITE.origin),
  title: { default: title, template: "%s · SPak" },
  description: SITE.description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website", siteName: SITE.name, url: "/", title, description: SITE.description, locale: "en",
    images: [OG_IMAGE],
  },
  twitter: { card: "summary_large_image", title, description: SITE.description, images: [OG_IMAGE.url] },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mkt">
      <SiteNav />
      <main id="main">{children}</main>
      <SiteFooter />
      <Reveal />
    </div>
  );
}
