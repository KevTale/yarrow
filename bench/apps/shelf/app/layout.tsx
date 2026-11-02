import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shelf",
  description: "Things for the kitchen, the desk, the outdoors and home.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">
            Shelf
          </Link>
          <span className="muted">Free shipping over $50</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
