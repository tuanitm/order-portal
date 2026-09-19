import type { Metadata } from "next";
import "./globals.css";
import { formatAppName } from "@/lib/appInfo";

// Read per request so a change to config.json's admin.companyPrefix shows up
// in the browser tab title (the admin area adds "(Admin)" on top of this).
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return {
    title: formatAppName("Ordering Portal"),
    description: "Order products directly and manage your orders efficiently.",
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
