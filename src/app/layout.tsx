import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SocialMind AI - Persona RAG Knowledge Base",
  description: "Ingest social media histories and query views grounded in real data",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
