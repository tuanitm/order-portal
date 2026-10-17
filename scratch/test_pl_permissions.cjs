const jwt = require("jsonwebtoken");
const http = require("http");

const JWT_SECRET = process.env.JWT_SECRET || "order-portal-secret-key-change-in-production";

function createToken(adminId, email, isSuperAdmin) {
  return jwt.sign({ adminId, email, isSuperAdmin }, JWT_SECRET, { expiresIn: "1h" });
}

function makeRequest(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const req = http.request({
      hostname: "localhost",
      port: 5005,
      path,
      method,
      headers: {
        "Cookie": `admin-token=${token}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  const normalAdminToken = createToken(7, "admin3@imv.com.vn", false);
  const superAdminToken = createToken(4, "admin@imv.com.vn", true);

  console.log("=== Testing Price Lists PATCH ===");

  // 1. Price List PATCH as Normal Admin
  const plRes1 = await makeRequest("PATCH", "/api/admin/price-lists/1", normalAdminToken, { isChannel: true });
  console.log("Normal Admin -> PATCH /api/admin/price-lists/1:", plRes1.statusCode, plRes1.body);

  // 2. Price List PATCH as Super Admin
  const plRes2 = await makeRequest("PATCH", "/api/admin/price-lists/1", superAdminToken, { isChannel: true });
  console.log("Super Admin -> PATCH /api/admin/price-lists/1:", plRes2.statusCode, plRes2.body);
}

run().catch(console.error);
