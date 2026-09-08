import type { Metadata } from "next";
import { fontVariables } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  // `template` gives every page its own tab title without each one repeating
  // the product name. `default` covers the routes that set no title.
  title: {
    default: "Portfolio Knowledge Base — Kodexo Labs",
    template: "%s — Kodexo Labs",
  },
  description:
    "Internal knowledge base of delivered projects, searchable by meaning.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-white font-body text-ink">
        {children}
      </body>
    </html>
  );
}
