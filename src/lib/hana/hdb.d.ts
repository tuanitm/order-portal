/**
 * `hdb` ships no TypeScript types and none exist on @types — minimal ambient
 * declaration covering only what src/lib/hana/client.ts actually uses.
 */
declare module "hdb" {
  interface HdbClientOptions {
    host: string;
    port: number;
    user: string;
    password: string;
  }
  interface HdbStatement {
    /** For a CALL: cb(err, scalarOutParams, tableOut1, tableOut2, …). */
    exec(params: unknown[], cb: (err: Error | null, ...results: unknown[]) => void): void;
  }
  interface HdbClient {
    connect(cb: (err: Error | null) => void): void;
    exec(sql: string, cb: (err: Error | null, rows: unknown[]) => void): void;
    prepare(sql: string, cb: (err: Error | null, statement: HdbStatement) => void): void;
    end(): void;
    on(event: "error", cb: (err: Error) => void): void;
  }
  function createClient(options: HdbClientOptions): HdbClient;
  export = { createClient };
}
