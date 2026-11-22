"use client";

import { styles } from "../../admin/adminUi";
import { AutoApprovalPanel } from "../../admin/AutoApprovalPanel";

/** /account/auto-approval — the Accountant's own Auto SO Approval (settings, runs, log). */
export default function AutoApprovalPage() {
  return (
    <div style={styles.page}>
      <div style={{ ...styles.container, maxWidth: 1400 }}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Auto SO Approval</h1>
            <p style={styles.subtitle}>
              Approve automatically the SOs waiting for you whose 6 checks all pass — on your own time windows and intervals.
            </p>
          </div>
        </div>
        <div style={styles.cardPadded}>
          <AutoApprovalPanel apiUrl="/api/admin/me/auto-approval" />
        </div>
      </div>
    </div>
  );
}
