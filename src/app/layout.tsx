import React from "react";
import type { Metadata } from "next";
import { JetBrains_Mono, Patrick_Hand } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/Sidebar";

const hand = Patrick_Hand({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-hand",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Whale Tracker — Kepemilikan Saham IDX di Atas 1%",
  description:
    "Kepemilikan saham di atas 1% (KSEI), rotasi sektor, aliran dana harga-volume, dan asisten riset berbasis data sistem.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${hand.variable} ${jetbrains.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
