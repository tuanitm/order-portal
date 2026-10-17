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

  console.log("=== Testing as Normal Admin (admin3, non-superadmin) ===");

  // 1. Customer Groups PATCH
  const cgRes1 = await makeRequest("PATCH", "/api/admin/customer-groups/1", normalAdminToken, { isActive: true });
  console.log("Normal Admin -> PATCH /api/admin/customer-groups/1:", cgRes1.statusCode, cgRes1.body);

  // 2. Item Groups PATCH
  const igRes1 = await makeRequest("PATCH", "/api/admin/item-groups/1", normalAdminToken, { isActive: true });
  console.log("Normal Admin -> PATCH /api/admin/item-groups/1:", igRes1.statusCode, igRes1.body);

  // 3. SAP Customers PATCH
  const sapCustRes1 = await makeRequest("PATCH", "/api/admin/sap-customers/C00001", normalAdminToken, { isEnabled: true });
  console.log("Normal Admin -> PATCH /api/admin/sap-customers/C00001:", sapCustRes1.statusCode, sapCustRes1.body);

  // 4. SAP Customers Sync
  const sapCustSync1 = await makeRequest("POST", "/api/admin/sap-customers/sync", normalAdminToken, {});
  console.log("Normal Admin -> POST /api/admin/sap-customers/sync:", sapCustSync1.statusCode, sapCustSync1.body);

  // 5. Items PATCH
  const itemRes1 = await makeRequest("PATCH", "/api/admin/items/ITEM001", normalAdminToken, { isActive: true });
  console.log("Normal Admin -> PATCH /api/admin/items/ITEM001:", itemRes1.statusCode, itemRes1.body);

  // 6. Items Sync
  const itemSync1 = await makeRequest("POST", "/api/admin/items/sync", normalAdminToken, {});
  console.log("Normal Admin -> POST /api/admin/items/sync:", itemSync1.statusCode, itemSync1.body);

  console.log("\n=== Testing as Super Admin (admin, is_root=1) ===");

  // 7. Customer Groups PATCH (Super Admin)
  const cgRes2 = await makeRequest("PATCH", "/api/admin/customer-groups/1", superAdminToken, { name: "GT" });
  console.log("Super Admin -> PATCH /api/admin/customer-groups/1:", cgRes2.statusCode, cgRes2.body);

  // 8. Items PATCH (Super Admin)
  const itemRes2 = await makeRequest("PATCH", "/api/admin/items/NON_EXISTENT_CODE", superAdminToken, { isActive: true });
  console.log("Super Admin -> PATCH /api/admin/items/NON_EXISTENT_CODE:", itemRes2.statusCode, itemRes2.body);
}

run().catch(console.error);
