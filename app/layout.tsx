import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ORG_NAME, ORG_TAGLINE } from "@/lib/config";
import { AISupportBot } from "@/components/AISupportBot";

export const viewport: Viewport = {
  themeColor: "#0A1128",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: `${ORG_NAME} — Daily Scrims, Tournaments & Leagues`,
    template: `%s | ${ORG_NAME}`,
  },
  description: ORG_TAGLINE,
  keywords: [
    "BGMI scrims",
    "esports tournaments",
    "gaming leagues",
    "cash prize tournaments",
    "BGMI tournament",
    "mobile esports India",
  ],
  authors: [{ name: ORG_NAME }],
  creator: ORG_NAME,
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: ORG_NAME,
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: ORG_NAME,
    title: `${ORG_NAME} — Daily Scrims, Tournaments & Leagues`,
    description: ORG_TAGLINE,
  },
  twitter: {
    card: "summary_large_image",
    title: `${ORG_NAME} — Daily Scrims, Tournaments & Leagues`,
    description: ORG_TAGLINE,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className="dark h-full antialiased"
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col bg-[#0A1128] text-slate-100 w-full max-w-full overflow-x-hidden">
        {children}
        <AISupportBot />
      </body>
    </html>
  );
}
