import hdb from "hdb";
import { loadConfig, resolveEnvSecret } from "@/lib/config";

/**
 * Direct SAP HANA connection — read-only, separate from (and independent
 * of) the SAP B1 Service Layer client in src/lib/sap-b1/client.ts. Exists
 * only because some data has NO access path through Service Layer at all:
 * no accessible raw SQLQueries route (blocked by B1's own "Query Generator
 * Authorization", an application-layer check, not a database one) AND no
 * dedicated Service Layer entity binding either (unlike e.g. Contract
 * Discounts/CBD or Customer Required Shelf Life/CSL, which do have one).
 * A genuine HANA database login bypasses B1's application layer entirely —
 * what it can/can't see is governed by ordinary HANA GRANTs on the
 * `hanadb.userId` user instead.
 *
 * One connection per call (connect → query → disconnect), not a pooled
 * singleton — this is only used for occasional admin-triggered syncs, not
 * request-path traffic, so the simplicity/robustness of a fresh connection
 * per run outweighs the cost of reconnecting.
 */

function getConnectionParams() {
  const hana = loadConfig().hanadb;
  const [host, portStr] = hana.hostname.split(":");
  const password = hana.passWrd.startsWith("ENV:")
    ? resolveEnvSecret(hana.passWrd.replace("ENV:", ""))
    : hana.passWrd;
  return { host, port: Number(portStr), user: hana.userId, password, schema: hana.schema };
}

/**
 * Run one SQL statement against HANA and return its rows. Connects fresh,
 * runs the query, disconnects — see the module doc for why.
 */
export async function queryHana<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const { host, port, user, password } = getConnectionParams();

  return new Promise<T[]>((resolve, reject) => {
    const client = hdb.createClient({ host, port, user, password });

    client.on("error", (err) => {
      reject(new Error(`[HANA] Connection error: ${err.message}`));
    });

    client.connect((connectErr) => {
      if (connectErr) {
        reject(new Error(`[HANA] Connect failed: ${connectErr.message}`));
        return;
      }
      client.exec(sql, (queryErr, rows) => {
        client.end();
        if (queryErr) {
          reject(new Error(`[HANA] Query failed: ${queryErr.message}`));
          return;
        }
        resolve(rows as T[]);
      });
    });
  });
}

/** The configured schema name (e.g. "IMV260806") — queries must qualify table names with it: `"SCHEMA"."@TABLE"`. */
export function getHanaSchema(): string {
  return getConnectionParams().schema;
}
