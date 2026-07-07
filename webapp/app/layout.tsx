import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "KitaiService — доставка из Китая",
  description: "Рассчитайте стоимость доставки товаров из Китая за 30 секунд.",
};

// viewportFit: 'cover' — обязательное условие, чтобы env(safe-area-inset-*) вообще работал на iPhone (вырез/индикатор жеста).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${inter.variable} h-full antialiased`}>
      <head>
        <link rel="preconnect" href="https://telegram.org" />
      </head>
      <body className="min-h-full flex flex-col">
        {/* beforeInteractive — грузится и выполняется до гидратации, поэтому window.Telegram.WebApp
            уже гарантированно доступен в первом эффекте страниц, без гонки и повторных проверок. */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
