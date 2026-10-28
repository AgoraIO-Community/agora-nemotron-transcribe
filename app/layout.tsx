import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "ज़ुबान रेस · Agora × NVIDIA Nemotron",
  description:
    "Ten Hindi or English tongue twisters. One playful AI host. Talk, get your word-match score, and find out what to practice.",
  icons: { icon: "/icon.svg" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="hi">
      <body>{children}</body>
    </html>
  );
}
