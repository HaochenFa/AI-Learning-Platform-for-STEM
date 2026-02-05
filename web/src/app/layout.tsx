import type { Metadata } from "next";
import { Geist_Mono, Open_Sans, Poppins } from "next/font/google";
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
  title: "STEM Learning Platform",
  description: "Teacher led, student centered STEM learning with AI powered course blueprints.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${bodyFont.variable} ${headingFont.variable} ${monoFont.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
