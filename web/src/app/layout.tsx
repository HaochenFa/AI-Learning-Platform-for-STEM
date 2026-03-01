import type { Metadata } from "next";
import { Geist_Mono, Open_Sans, Poppins } from "next/font/google";
import type { CSSProperties } from "react";
import MotionProvider from "@/components/providers/motion-provider";
import "./globals.css";

const bodyFont = Open_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const headingFont = Poppins({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const monoFont = Geist_Mono({
  variable: "--font-code",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Learning Platform",
  description: "Teacher-led, student-centered learning with AI-powered course blueprints.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${bodyFont.variable} ${headingFont.variable} ${monoFont.variable} antialiased`}
        style={
          {
            "--font-editorial": "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
          } as CSSProperties
        }
      >
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
