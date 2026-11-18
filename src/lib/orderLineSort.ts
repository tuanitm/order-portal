/**
 * Display / SAP-push order of an order's lines: each buy line, then its free
 * item lines — the bought item itself given free first, then any other free
 * items (promotion "case c" has both). Buy lines (and gift lines whose buy
 * line is missing) keep their own order (by id).
 */
export function sortOrderLines<
  T extends { id: number; sap_item_code: string; is_gift_line: number | boolean | null; source_line_id: number | null },
>(lines: T[]): T[] {
  const ids = new Set(lines.map((l) => l.id));
  const isAttachedGift = (l: T) => !!l.is_gift_line && l.source_line_id != null && ids.has(l.source_line_id);
  const out: T[] = [];
  for (const buy of lines.filter((l) => !isAttachedGift(l)).sort((a, b) => a.id - b.id)) {
    out.push(buy);
    const gifts = lines
      .filter((g) => isAttachedGift(g) && g.source_line_id === buy.id)
      .sort((a, b) => Number(a.sap_item_code !== buy.sap_item_code) - Number(b.sap_item_code !== buy.sap_item_code) || a.id - b.id);
    out.push(...gifts);
  }
  return out;
}
