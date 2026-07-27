import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: "ProfilePilot — AI Dating Profile Optimizer",
  description:
    "Upload your photos and bio and get AI-powered feedback: per-photo scores, the best first photo, ideal ordering, red/green flags, and a personal coach.",
  applicationName: "ProfilePilot",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "ProfilePilot", statusBarStyle: "black-translucent" },
  openGraph: {
    title: "ProfilePilot — AI Dating Profile Optimizer",
    description: "Optimize your dating profile with AI. Private by design.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
};

// Set the theme class before hydration to avoid a flash of the wrong theme.
const noFlashScript = `(function(){try{var t=localStorage.getItem('profilepilot:theme')||'dark';document.documentElement.classList.toggle('dark',t==='dark');}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body className="min-h-screen">
        <ThemeProvider>
          <div className="flex min-h-screen flex-col">
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </div>
          <PwaRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
