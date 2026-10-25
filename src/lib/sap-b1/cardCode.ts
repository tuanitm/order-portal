import { getSapClient } from "./client";

/**
 * Generates the next sequential, fixed 8-character CardCode for a new BP,
 * prefixed by its Customer Group 3 code (e.g. "GTSO01" + "05" ->
 * "GTSO0105"). Queries SAP LIVE (not the local `customers` cache) via
 * findMaxCardCodeWithPrefix to avoid colliding with a BP created since the
 * last sync — a CardCode collision is a hard SAP-side rejection.
 */
export async function generateCardCode(level3Code: string): Promise<string> {
  const prefix = level3Code.trim().toUpperCase();
  const totalLength = 8;
  const suffixLength = totalLength - prefix.length;
  if (suffixLength < 1) {
    throw new Error(
      `Customer Group 3 code "${prefix}" is too long to leave room for a sequence suffix in an ${totalLength}-character CardCode`
    );
  }

  const client = getSapClient();
  const maxExisting = await client.findMaxCardCodeWithPrefix(prefix);

  let nextSeq = 1;
  if (maxExisting && maxExisting.length === totalLength) {
    const parsed = parseInt(maxExisting.slice(prefix.length), 10);
    if (!isNaN(parsed)) nextSeq = parsed + 1;
  }

  const maxSeq = Math.pow(10, suffixLength) - 1;
  if (nextSeq > maxSeq) {
    throw new Error(`No more CardCode sequence numbers available for prefix "${prefix}" (exhausted ${maxSeq})`);
  }

  return prefix + String(nextSeq).padStart(suffixLength, "0");
}
