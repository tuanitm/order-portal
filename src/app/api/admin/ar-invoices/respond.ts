import { NextResponse } from "next/server";
import { ArError } from "@/lib/arInvoice/service";

/** JSON error response for the AR Invoice routes (ArError → its status; anything else → 500). */
export function arErrorResponse(error: unknown, label: string) {
  if (error instanceof ArError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  console.error(`[AR Invoice] ${label}:`, error);
  return NextResponse.json({ error: `${label}: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}` }, { status: 500 });
}

export const idOf = async (params: Promise<{ id: string }>) => {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) throw new ArError("AR Invoice not found", 404);
  return id;
};
