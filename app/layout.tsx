import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShelfScout — Your next great read",
  description: "A private book-discovery companion for Goodreads, BookOrbit, and Kobo.",
  applicationName: "ShelfScout",
  appleWebApp: { capable: true, title: "ShelfScout", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/icon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = { themeColor: "#245a49" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
