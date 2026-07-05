import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-outfit"
});

export const metadata: Metadata = {
  title: "Tradr",
  description: "KTrade automation, portfolio analytics, and PSX trading signals",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f9fc" },
    { media: "(prefers-color-scheme: dark)", color: "#060608" }
  ]
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={outfit.variable} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement;if(localStorage.getItem("tradr-theme")==="dark")d.classList.add("theme-dark");}catch(e){}})();`
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
