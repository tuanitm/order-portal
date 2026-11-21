"use client";

import { StaffShell } from "../admin/layout";

/** /account — the Accountant (AR / Credit Control) area: SO Approval and My Profile (see StaffShell). */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <StaffShell area="account">{children}</StaffShell>;
}
