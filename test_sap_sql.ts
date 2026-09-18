import { getSapClient } from './src/lib/sap-b1/client.ts';

async function test() {
  try {
    const sap = getSapClient();
    const res = await sap.executePromotionSql();
    console.log(`Success:`, res);
  } catch (e) {
    console.error(`Error:`, e);
  }
  process.exit(0);
}
test();
