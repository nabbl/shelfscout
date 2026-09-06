import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShelfScout — Your next great read",
  description: "A private book-discovery companion for Goodreads, BookOrbit, and Kobo.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
