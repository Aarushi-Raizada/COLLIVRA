import type { Metadata } from "next";
import React from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "COLLIVRA — Space Situational Awareness & Orbital Sustainability",
  description:
    "COLLIVRA: Operational decision-support platform for space situational awareness, synthetic collision intelligence, and Clohessy-Wiltshire remediation planning. Developed by Team Errorists for ASTRA 2026, VIT Bhopal. See the risk. Secure the orbit.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans bg-space-bg text-slate-100 antialiased min-h-screen flex flex-col">
        {children}
      </body>
    </html>
  );
}
