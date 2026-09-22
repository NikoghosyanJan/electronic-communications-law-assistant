import type { Metadata } from "next";
import { DM_Sans, Noto_Sans_Armenian, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const sans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
});

const hy = Noto_Sans_Armenian({
  variable: "--font-hy",
  subsets: ["armenian"],
  weight: ["400", "500", "600", "700"],
});

const display = Source_Serif_4({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"],
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  title: "RA Electronic Communications Law Assistant",
  description:
    "Grounded Q&A and multi-LLM benchmark over the Armenian Electronic Communications Law",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${hy.variable} ${display.variable} h-full`}
    >
      <body className="flex min-h-full flex-col antialiased">{children}</body>
    </html>
  );
}
