import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { APP_RUNTIME } from "@/config/app-runtime";
import { withBasePath } from "@/lib/base-path";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const isLoopbackHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (isLoopbackHost ? "http" : "https");
  const ogImage = `${protocol}://${host}${withBasePath("/og.png")}`;
  return {
    title: { default: "Project AI OS", template: "%s · Project AI OS" },
    description: "面向项目经理的 AI 项目交付工作台",
    icons: { icon: withBasePath("/favicon.svg"), shortcut: withBasePath("/favicon.svg") },
    openGraph: {
      title: "Project AI OS",
      description: "项目交付的 AI 工作系统",
      type: "website",
      locale: "zh_CN",
      images: [{ url: ogImage, width: 1672, height: 941, alt: "Project AI OS 项目交付工作台" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Project AI OS",
      description: "项目交付的 AI 工作系统",
      images: [ogImage],
    },
    robots: APP_RUNTIME.isStaging
      ? {
          index: false,
          follow: false,
          noarchive: true,
          nocache: true,
          googleBot: {
            index: false,
            follow: false,
            noimageindex: true,
          },
        }
      : undefined,
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
