import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Injection Viewer",
  description: "Visualize AgentDojo prompt injection runs",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <nav className="flex h-[49px] shrink-0 items-center gap-5 border-b border-border bg-surface px-4 text-sm">
          <Link href="/" className="font-semibold">
            Injection Viewer
          </Link>
          <Link href="/" className="text-muted hover:text-foreground">
            Runs
          </Link>
          <Link href="/live" className="text-muted hover:text-foreground">
            Live
          </Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
