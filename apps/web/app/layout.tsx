import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgroPulse | Gestão rural inteligente",
  description: "Gerencie fazendas e talhões, acompanhe telemetria e monitore sua produção agrícola.",
  icons: { icon: "/field-mark.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
