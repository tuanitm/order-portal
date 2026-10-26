"use client";

import { styles } from "../adminUi";
import IdResetSection from "./IdResetSection";

export default function IdResetPage() {
  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Reset the Id</h1>
            <p style={styles.subtitle}>Root-only. Renumber the ids of tables that SAP syncs keep rewriting.</p>
          </div>
        </div>

        <IdResetSection />
      </div>
    </div>
  );
}
