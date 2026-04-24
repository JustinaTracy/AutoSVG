import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoSVG — Cut-Ready SVG Converter",
  description:
    "Convert PNG, JPEG, and SVG files into clean, cut-ready SVGs for Cricut and Silhouette machines.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
