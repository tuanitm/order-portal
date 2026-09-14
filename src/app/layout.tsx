import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ordering Portal",
  description: "Order products directly and manage your orders efficiently.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
