import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedScript India",
  description: "Digital Prescription & Medical Report Automation Platform — India-compliant",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
