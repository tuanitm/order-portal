import { NextRequest, NextResponse } from 'next/server';
import { requireAdminPermission } from '@/lib/auth/adminSession';
import { syncOneOrderStatusFromSap } from '@/lib/orderStatusSync';
import { isOrderInAdminScope } from '@/lib/adminScope';

/** POST /api/admin/orders/[id]/sync-status ? manual SAP status sync button */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, 'orders');
  if (guard.response) return guard.response;
  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });

  if (!(await isOrderInAdminScope(guard.session, orderId))) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }
  try {
    const result = await syncOneOrderStatusFromSap(orderId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[Admin] sync-status failed:', error);
    return NextResponse.json(
      { error: 'Failed to sync status from SAP', message: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}