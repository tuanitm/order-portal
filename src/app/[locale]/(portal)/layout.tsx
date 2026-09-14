"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "@/i18n/navigation";
import { CartProvider } from "@/hooks/useCart";
import Navbar from "@/components/layout/Navbar";
import CartSidebar from "@/components/layout/CartSidebar";
import Footer from "@/components/layout/Footer";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        setIsAuthenticated(true);
      } else {
        // Not authenticated → redirect to identify page
        router.replace("/identify");
      }
    } catch {
      router.replace("/identify");
    } finally {
      setIsChecking(false);
    }
  }, [router]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Show loading while checking auth
  if (isChecking) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-secondary, #F8FAFC)",
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: "50%",
          border: "3px solid var(--color-gray-200, #E2E8F0)",
          borderTopColor: "var(--color-primary, #2BBCB3)",
          animation: "spin 0.8s linear infinite",
        }} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <CartProvider>
      <Navbar />
      <main>{children}</main>
      <CartSidebar />
      <Footer />
    </CartProvider>
  );
}
