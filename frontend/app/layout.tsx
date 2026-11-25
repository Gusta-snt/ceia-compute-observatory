import "./globals.css";
import type { Metadata } from "next";
import Shell from "@/components/Shell";
import { THEME_BOOT } from "@/lib/theme";

export const metadata: Metadata = { title: "CEIA Compute Observatory", description: "Monitoramento histórico e análise de capacidade das DGX Sparks" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} /></head>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
