import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "Дневник тренировок";
const description =
  "Семейный дневник тренировок с быстрым вводом подходов, офлайн-режимом и понятным прогрессом.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const origin = host ? `${protocol}://${host}` : "https://app.local";
  const socialImage = `${origin}/og.png`;

  return {
    title,
    description,
    applicationName: title,
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "Тренировки",
    },
    formatDetection: { telephone: false },
    manifest: "/manifest.webmanifest",
    icons: {
      icon: "/app-icon.svg",
      shortcut: "/app-icon.svg",
      apple: "/app-icon.svg",
    },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "ru_RU",
      images: [{ url: socialImage, width: 1715, height: 909, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f2f3f0",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
