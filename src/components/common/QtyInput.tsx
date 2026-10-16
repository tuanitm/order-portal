"use client";

import { useState, useEffect } from "react";

/**
 * Typeable quantity box (not just +/- buttons) — a customer ordering e.g.
 * 200 pcs shouldn't have to click an increment button 200 times. Keeps its
 * own draft string while typing (so a mid-edit value like "" or "2" isn't
 * immediately clobbered by the committed quantity), and only commits on
 * blur or Enter. An invalid or empty draft reverts to the last committed
 * value rather than silently zeroing it. Shared by CartSidebar and
 * ProductCard's qty stepper.
 */
export default function QtyInput({
  value,
  onCommit,
  className,
  ariaLabel,
}: {
  value: number;
  onCommit: (quantity: number) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    onCommit(Math.max(0, parsed));
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      className={className}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          e.currentTarget.blur();
        }
      }}
      aria-label={ariaLabel || "Quantity"}
    />
  );
}
