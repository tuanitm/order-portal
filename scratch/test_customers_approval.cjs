const jwt = require("jsonwebtoken");
const http = require("http");

const JWT_SECRET = process.env.JWT_SECRET || "order-portal-secret-key-change-in-production";

function createToken(adminId, email, isSuperAdmin) {
  return jwt.sign({ adminId, email, isSuperAdmin }, JWT_SECRET, { expiresIn: "1h" });
}

function makeRequest(path, token, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : "";
    const headers = {
      "Cookie": `admin-token=${token}`,
    };
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(postData);
    }
    const req = http.request({
      hostname: "localhost",
      port: 5005,
      path,
      method,
      headers,
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(postData);
    req.end();
  });
}

async function run() {
  const superToken = createToken(4, "admin@imv.com.vn", true);
  const admin2Token = createToken(6, "admin2@imv.com.vn", false);
  const admin3Token = createToken(7, "admin3@imv.com.vn", false);

  console.log("=== 1. Listing Customers ===");
  const resSuper = await makeRequest("/api/admin/customers?status=all", superToken);
  console.log("Super Admin customers count:", resSuper.body.customers ? resSuper.body.customers.length : resSuper);

  const res2 = await makeRequest("/api/admin/customers?status=all", admin2Token);
  console.log("Admin 2 (GTSO) customers count:", res2.body.customers ? res2.body.customers.length : res2);

  const res3 = await makeRequest("/api/admin/customers?status=all", admin3Token);
  console.log("Admin 3 (GTNO) customers count:", res3.body.customers ? res3.body.customers.length : res3);

  console.log("\n=== 2. Testing Scope Protection on Actions ===");
  // Customer 5 is GTSO0701. Admin 3 (GTNO) attempts to approve / reject:
  const approve3 = await makeRequest("/api/admin/customers/5/approve", admin3Token, "POST");
  console.log("Admin 3 approve customer 5 response:", approve3);

  const reject3 = await makeRequest("/api/admin/customers/5/reject", admin3Token, "POST", { reason: "test" });
  console.log("Admin 3 reject customer 5 response:", reject3);

  const resync3 = await makeRequest("/api/admin/customers/5/resync-sap", admin3Token, "POST");
  console.log("Admin 3 resync customer 5 response:", resync3);

  // Admin 2 (GTSO) attempts resync-sap on customer 5 (should NOT be 403 Forbidden):
  const resync2 = await makeRequest("/api/admin/customers/5/resync-sap", admin2Token, "POST");
  console.log("Admin 2 (GTSO) resync customer 5 status (expecting != 403):", resync2.status, resync2.body.error || resync2.body.success);
}

run().catch(console.error);
