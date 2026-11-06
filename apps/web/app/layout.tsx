import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgroPulse | Inteligência de campo",
  description: "Conecte sensores, clima e histórico de manejo para acompanhar cada talhão.",
  icons: { icon: "/field-mark.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
