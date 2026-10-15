"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import logo from "@/app/icon.png";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { useCart } from "@/hooks/useCart";
import { useSearch } from "@/hooks/useSearch";
import { useAppName } from "@/hooks/useAppName";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useOnPushNotification } from "@/hooks/usePushRefresh";
import { Link } from "@/i18n/navigation";

interface AuthUser {
  fullName: string;
  email: string | null;
}

interface UnreadOrderSummary {
  order_id: number;
  order_number: string;
  unread_count: number;
  latest_message: string;
  latest_created_at: string;
}

export default function Navbar() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { totalItems, toggleCart } = useCart();
  const { searchQuery, setSearchQuery } = useSearch();
  const appName = useAppName();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  // Admin -> customer order messages notification (see order_messages) —
  // polled periodically and refreshed on navigation, since admin posts
  // these asynchronously and the customer has no other way to find out.
  const [totalUnread, setTotalUnread] = useState(0);
  const [unreadOrders, setUnreadOrders] = useState<UnreadOrderSummary[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      }
    } catch {
      // Not logged in
    }
  }, []);

  const checkUnreadMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/orders/messages/unread");
      if (res.ok) {
        const data = await res.json();
        setTotalUnread(data.totalUnread || 0);
        setUnreadOrders(data.orders || []);
      }
    } catch {
      // Not logged in, or request failed — leave the last-known count as is
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!user) return;
    checkUnreadMessages();
    const interval = setInterval(checkUnreadMessages, 30000);
    return () => clearInterval(interval);
  }, [user, checkUnreadMessages]);

  // Coming back from an order page (where opening the thread marks it
  // read) should clear the badge sooner than the next 30s poll.
  useEffect(() => {
    if (user) checkUnreadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Browser push — a second, native-OS-level channel for the same
  // admin -> customer order messages notification above (so the customer
  // finds out even without the tab open). Only after login.
  usePushNotifications(!!user);

  // When a push arrives while a tab IS open, refresh the badge right away
  // instead of waiting for the next 30s poll — see public/sw.js.
  useOnPushNotification(useCallback(() => {
    if (user) checkUnreadMessages();
  }, [user, checkUnreadMessages]));

  const handleLogout = async () => {
    try {
      // Clear the auth cookie by setting it to expire
      document.cookie = "auth-token=; path=/; max-age=0";
      setUser(null);
      setShowMenu(false);
      window.location.href = `/${locale}/identify`;
    } catch {
      window.location.href = `/${locale}/identify`;
    }
  };

  // Products are only listed on the home page — searching from anywhere else
  // (orders, checkout...) takes the customer there to see the results.
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (value && pathname !== "/") router.push("/");
  };

  const switchLocale = () => {
    const newLocale = locale === "vi" ? "en" : "vi";
    router.replace(pathname, { locale: newLocale });
  };

  return (
    <nav className="navbar" id="main-navbar">
      <div className="navbar__inner">
        {/* Logo */}
        <Link href="/" className="navbar__logo" id="navbar-logo">
          <Image
            src={logo}
            alt=""
            width={40}
            height={40}
            className="navbar__logo-icon"
            style={{ objectFit: "contain" }}
            priority
          />
          <span>{appName}</span>
        </Link>

        {/* Search Bar */}
        <div className="navbar__search" id="navbar-search">
          <svg className="navbar__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="navbar__search-input"
            placeholder={t("product.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            id="navbar-search-input"
          />
        </div>

        {/* Actions */}
        <div className="navbar__actions">
          {/* Language Switcher */}
          <button
            className="navbar__lang-btn"
            onClick={switchLocale}
            id="lang-switcher"
            aria-label={t("nav.language")}
          >
            {locale === "vi" ? "🇻🇳 VI" : "🇬🇧 EN"}
          </button>

          {/* Cart */}
          <button
            className="navbar__cart-btn"
            onClick={toggleCart}
            id="cart-toggle"
            aria-label={t("nav.cart")}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            {totalItems > 0 && (
              <span className="navbar__cart-badge" id="cart-badge">
                {totalItems}
              </span>
            )}
          </button>

          {/* Order messages notification — admin -> customer messages on
              one of their orders (see order_messages). Only meaningful
              once logged in (messages are per-order, orders are per-account). */}
          {user && (
            <div style={{ position: "relative" }}>
              <button
                className="navbar__cart-btn"
                onClick={() => setShowNotifications((v) => !v)}
                id="message-toggle"
                aria-label={locale === "vi" ? "Thông báo tin nhắn đơn hàng" : "Order message notifications"}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
                {totalUnread > 0 && (
                  <span className="navbar__cart-badge" id="message-badge" style={{ background: "#DC2626" }}>
                    {totalUnread}
                  </span>
                )}
              </button>

              {showNotifications && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setShowNotifications(false)} />
                  <div style={{
                    position: "absolute", right: 0, top: "calc(100% + 0.5rem)",
                    background: "var(--bg-primary, #fff)",
                    borderRadius: "var(--radius-lg, 8px)",
                    boxShadow: "0 10px 40px rgba(0,0,0,0.12)",
                    border: "1px solid var(--color-gray-200, #E2E8F0)",
                    minWidth: "280px", maxWidth: "340px", maxHeight: "360px", overflowY: "auto",
                    padding: "0.375rem", zIndex: 50,
                    animation: "fadeIn 0.15s ease-out",
                  }}>
                    <div style={{ padding: "0.5rem 0.75rem", fontSize: "0.75rem", fontWeight: 700, color: "var(--text-tertiary, #94A3B8)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {locale === "vi" ? "Tin nhắn đơn hàng" : "Order Messages"}
                    </div>
                    {unreadOrders.length === 0 ? (
                      <div style={{ padding: "0.75rem", fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)" }}>
                        {locale === "vi" ? "Không có tin nhắn mới." : "No new messages."}
                      </div>
                    ) : (
                      unreadOrders.map((o) => (
                        <Link
                          key={o.order_id}
                          href={`/orders/${o.order_id}`}
                          onClick={() => setShowNotifications(false)}
                          style={{
                            display: "block", padding: "0.625rem 0.75rem", borderRadius: "var(--radius-md, 6px)",
                            textDecoration: "none", color: "var(--text-primary, #0F172A)",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-secondary, #F8FAFC)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.1875rem" }}>
                            <span style={{ fontSize: "0.8125rem", fontWeight: 700 }}>{o.order_number}</span>
                            <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#DC2626", background: "#FEF2F2", borderRadius: "var(--radius-full, 999px)", padding: "0.0625rem 0.4375rem" }}>
                              {o.unread_count}
                            </span>
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary, #64748B)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {o.latest_message}
                          </div>
                        </Link>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* User Menu */}
          {user ? (
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowMenu(!showMenu)}
                id="user-menu-btn"
                style={{
                  display: "flex", alignItems: "center", gap: "0.5rem",
                  padding: "0.375rem 0.75rem", borderRadius: "var(--radius-full, 999px)",
                  border: "1px solid var(--color-gray-200, #E2E8F0)",
                  background: "var(--bg-primary, #fff)", cursor: "pointer",
                  fontSize: "0.8125rem", fontWeight: 600,
                  color: "var(--text-primary, #0F172A)",
                  transition: "all 0.2s ease",
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: "linear-gradient(135deg, var(--color-primary, #2BBCB3), var(--color-primary-dark, #1E9A92))",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontSize: "0.75rem", fontWeight: 700,
                }}>
                  {user.fullName.charAt(0).toUpperCase()}
                </div>
                <span style={{ maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user.fullName}
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {/* Dropdown Menu */}
              {showMenu && (
                <>
                  <div
                    style={{ position: "fixed", inset: 0, zIndex: 40 }}
                    onClick={() => setShowMenu(false)}
                  />
                  <div style={{
                    position: "absolute", right: 0, top: "calc(100% + 0.5rem)",
                    background: "var(--bg-primary, #fff)",
                    borderRadius: "var(--radius-lg, 8px)",
                    boxShadow: "0 10px 40px rgba(0,0,0,0.12)",
                    border: "1px solid var(--color-gray-200, #E2E8F0)",
                    minWidth: "180px", padding: "0.375rem", zIndex: 50,
                    animation: "fadeIn 0.15s ease-out",
                  }}>
                    <div style={{
                      padding: "0.625rem 0.75rem",
                      borderBottom: "1px solid var(--color-gray-200, #E2E8F0)",
                      marginBottom: "0.375rem",
                    }}>
                      <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-primary, #0F172A)" }}>
                        {user.fullName}
                      </div>
                      {user.email && (
                        <div style={{ fontSize: "0.6875rem", color: "var(--text-tertiary, #94A3B8)", marginTop: "0.125rem" }}>
                          {user.email}
                        </div>
                      )}
                    </div>
                    <Link
                      href="/orders"
                      onClick={() => setShowMenu(false)}
                      style={{
                        display: "flex", alignItems: "center", gap: "0.5rem",
                        padding: "0.5rem 0.75rem", borderRadius: "var(--radius-md, 6px)",
                        fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)",
                        textDecoration: "none", transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-secondary, #F8FAFC)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      📦 {t("nav.orders")}
                    </Link>
                    <button
                      onClick={handleLogout}
                      id="logout-btn"
                      style={{
                        display: "flex", alignItems: "center", gap: "0.5rem",
                        width: "100%", padding: "0.5rem 0.75rem",
                        borderRadius: "var(--radius-md, 6px)",
                        border: "none", background: "transparent",
                        fontSize: "0.8125rem", color: "#DC2626",
                        cursor: "pointer", transition: "background 0.15s",
                        textAlign: "left",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#FEF2F2")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      🚪 {t("nav.logout")}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <Link href="/identify" className="btn btn-primary btn-sm" id="login-btn">
              {t("nav.login")}
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}

