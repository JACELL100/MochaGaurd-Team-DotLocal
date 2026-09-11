import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/layout/Header";
import { currentViewer } from "@/lib/supabase/server";
import { Footer } from "@/components/layout/Footer";
import { Web3Provider } from "@/components/Web3Provider";
import { CopilotChat } from "@/components/CopilotChat";
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
  title: { default: "MochaGuard Risk", template: "%s · MochaGuard" },
  description: "Sleep-safe leverage & overnight margin surveillance: explained by an AI copilot, provable on-chain.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Resolved on the server so the header's identity is correct in the first paint.
  const viewer = await currentViewer();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-[#05050A] text-[#F8FAFC]">
        <Web3Provider>
          <Header viewer={viewer} />
          <main className="flex-1 w-full pt-16">{children}</main>
          <Footer />
          <CopilotChat />
        </Web3Provider>
      </body>
    </html>
  );
}
