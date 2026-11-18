"use client";

import { StaffShell } from "../admin/layout";

/** /sales — the Sales area: the staff shell limited to Orders, Inventory and My Profile (see StaffShell). */
export default function SalesLayout({ children }: { children: React.ReactNode }) {
  return <StaffShell area="sales">{children}</StaffShell>;
}
