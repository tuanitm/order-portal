const jwt = require("jsonwebtoken");
const http = require("http");

const JWT_SECRET = process.env.JWT_SECRET || "order-portal-secret-key-change-in-production";

function createToken(adminId, email, isSuperAdmin) {
  return jwt.sign({ adminId, email, isSuperAdmin }, JWT_SECRET, { expiresIn: "1h" });
}

function makeRequest(path, token) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = http.request({
      hostname: "localhost",
      port: 5005,
      path,
      method: "GET",
      headers: {
        "Cookie": `admin-token=${token}`,
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        const ms = Date.now() - start;
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), ms });
        } catch {
          resolve({ status: res.statusCode, data, ms });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function run() {
  const admin3Token = createToken(7, "admin3@imv.com.vn", false);
  const superToken = createToken(4, "admin@imv.com.vn", true);

  console.log("Calling /api/admin/promotions as admin3...");
  const res3 = await makeRequest("/api/admin/promotions?limit=10", admin3Token);
  console.log(`admin3 response status: ${res3.status} in ${res3.ms}ms, total rows: ${res3.data.total}`);
  if (res3.data.promotions && res3.data.promotions.length > 0) {
    console.log("admin3 first 3 promotions:");
    res3.data.promotions.slice(0, 3).forEach((p) => {
      console.log(` - Promo: ${p.promotion_code} | BP: ${p.bp_code} (${p.bp_name}) | Item: ${p.selling_item_code} (${p.selling_item_name})`);
    });
  }

  console.log("\nCalling /api/admin/promotions as Super Admin...");
  const resSuper = await makeRequest("/api/admin/promotions?limit=10", superToken);
  console.log(`Super Admin response status: ${resSuper.status} in ${resSuper.ms}ms, total rows: ${resSuper.data.total}`);
}

run().catch(console.error);
