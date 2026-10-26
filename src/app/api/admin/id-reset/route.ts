import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { previewIdReset, resetTableIds, isResettableTable } from "@/lib/db/idReset";
import { TableLockBusyError } from "@/lib/db/tableLock";
import { logAuditEvent } from "@/lib/auditLog";

/** GET — per-table id usage for the Admin → Settings → "Reset the Id" page (root only). */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "id-reset");
  if (guard.response) return guard.response;

  try {
    return NextResponse.json({ tables: await previewIdReset() });
  } catch (error) {
    console.error("[Admin] Id reset preview failed:", error);
    return NextResponse.json({ error: "Failed to read table ids" }, { status: 500 });
  }
}

/** POST { table } — renumbers that table's ids to 1..N (see src/lib/db/idReset.ts). */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "id-reset");
  if (guard.response) return guard.response;

  const { table } = await request.json().catch(() => ({}));
  if (typeof table !== "string" || !isResettableTable(table)) {
    return NextResponse.json({ error: "This table can't be reset" }, { status: 400 });
  }

  try {
    const result = await resetTableIds(table);
    await logAuditEvent({
      actorType: "admin", actorId: guard.session.adminId, actorLabel: guard.session.email,
      action: "id_reset", entityType: "table", entityId: table,
      details: { ...result },
      request,
    });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    if (error instanceof TableLockBusyError) {
      return NextResponse.json(
        { error: "A sync or another reset is running on this table — try again when it has finished." },
        { status: 409 }
      );
    }
    console.error(`[Admin] Id reset of ${table} failed:`, error);
    await logAuditEvent({
      actorType: "admin", actorId: guard.session.adminId, actorLabel: guard.session.email,
      action: "id_reset_failed", entityType: "table", entityId: table,
      details: { message: error instanceof Error ? error.message : String(error) },
      request,
    });
    return NextResponse.json(
      { error: "Reset failed — nothing was changed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
