"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";

/**
 * Shared helpers for wide staff tables: a floating horizontal scrollbar and
 * drag-to-resize columns. Used by SO Approval (Order lines) and Sales Detail.
 *
 * Usage:
 *   const scroll = useFloatingScroll();
 *   <div ref={scroll.wrapRef} onScroll={scroll.onWrapScroll} style={{ overflowX: "auto", scrollbarWidth: "none" }}>
 *     <table ref={scroll.tableRef}>…</table>
 *   </div>
 *   {scroll.bar}
 */
/**
 * A horizontal scrollbar that floats at the bottom of the window while a wide
 * table is on screen (the table's own scrollbar is hidden — it would be far
 * below when there are many lines). Both stay in sync; ◀ ▶ step by 300 px.
 */
export function useFloatingScroll() {
  // Callback refs (kept in state), so a table that appears later — after data loads — is still measured.
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const [tableEl, setTableEl] = useState<HTMLTableElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ content: 0, view: 0 });
  const setWrap = useCallback((el: HTMLDivElement | null) => { wrapRef.current = el; setWrapEl(el); }, []);
  useEffect(() => {
    if (!wrapEl || !tableEl) { setDims({ content: 0, view: 0 }); return; }
    const measure = () => setDims({ content: tableEl.scrollWidth, view: wrapEl.clientWidth });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrapEl);
    ro.observe(tableEl);
    return () => ro.disconnect();
  }, [wrapEl, tableEl]);
  const follow = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to) return;
    // Proportional, and only when off by > 1 px, so the two never ping-pong.
    const fromRange = from.scrollWidth - from.clientWidth, toRange = to.scrollWidth - to.clientWidth;
    const target = fromRange > 0 ? (from.scrollLeft / fromRange) * toRange : 0;
    if (Math.abs(to.scrollLeft - target) > 1) to.scrollLeft = target;
  };
  const onWrapScroll = () => follow(wrapRef.current, barRef.current);
  const step = (dx: number) => wrapRef.current?.scrollBy({ left: dx, behavior: "smooth" });
  const overflow = dims.content > dims.view + 1;
  const arrow: CSSProperties = { border: "1px solid var(--color-gray-200, #E2E8F0)", background: "var(--bg-primary, #fff)", borderRadius: 6, cursor: "pointer", fontSize: "0.7rem", padding: "0 0.45rem", lineHeight: "18px", color: "var(--text-secondary, #64748B)" };
  const bar = overflow ? (
    <div style={{ position: "sticky", bottom: 0, zIndex: 5, display: "flex", alignItems: "center", gap: 6, padding: "4px 0", background: "var(--bg-primary, #fff)", borderTop: "1px solid var(--color-gray-200, #E2E8F0)" }}>
      <button type="button" style={arrow} onClick={() => step(-300)} aria-label="Scroll left">◀</button>
      <div ref={barRef} onScroll={() => follow(barRef.current, wrapRef.current)} style={{ flex: 1, overflowX: "auto", overflowY: "hidden", height: 16 }}>
        <div style={{ width: dims.content, height: 1 }} />
      </div>
      <button type="button" style={arrow} onClick={() => step(300)} aria-label="Scroll right">▶</button>
    </div>
  ) : null;
  return { wrapRef: setWrap, tableRef: setTableEl, onWrapScroll, bar };
}

/**
 * Column widths (px) that the user can drag. `defaults` gives each column's
 * starting width; `storageKey` (optional) remembers the widths in this browser.
 */
export function useColumnWidths(defaults: (key: string) => number, storageKey?: string) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  // Saved widths are read after mount (not during render), so server and first client render agree.
  useEffect(() => {
    if (!storageKey) return;
    try { setWidths(JSON.parse(window.localStorage.getItem(storageKey) || "{}") as Record<string, number>); } catch { /* none saved / blocked */ }
  }, [storageKey]);
  /** Change the widths and remember them (only on the user's own drag / reset — never overwrites with the empty start). */
  const update = (fn: (w: Record<string, number>) => Record<string, number>) => setWidths((w) => {
    const next = fn(w);
    if (storageKey) try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* private mode etc. — not remembered */ }
    return next;
  });
  const widthOf = (key: string) => widths[key] ?? defaults(key);
  const startResize = (key: string) => (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX, w0 = widthOf(key);
    const move = (ev: MouseEvent) => update((w) => ({ ...w, [key]: Math.max(40, w0 + ev.clientX - x0) }));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); document.body.style.cursor = ""; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.style.cursor = "col-resize";
  };
  const reset = (key: string) => update((w) => { const n = { ...w }; delete n[key]; return n; });
  /** The drag handle to put inside a header cell (the <th> needs position: relative). */
  const handle = (key: string) => (
    <span onMouseDown={startResize(key)} onDoubleClick={() => reset(key)} onClick={(e) => e.stopPropagation()}
      title="Drag to resize · double-click to reset"
      style={{ position: "absolute", top: 0, right: 0, width: 6, height: "100%", cursor: "col-resize", borderRight: "2px solid var(--color-gray-200, #E2E8F0)" }} />
  );
  return { widthOf, handle, resetAll: () => update(() => ({})) };
}

/** Header cell style for a resizable column. */
export const resizableTh: CSSProperties = { position: "relative", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
