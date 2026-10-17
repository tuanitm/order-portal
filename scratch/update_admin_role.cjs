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
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  const superToken = createToken(4, "admin@imv.com.vn", true);
  const permissions = [
    "dashboard",
    "customers",
    "customer-groups",
    "sap-customers",
    "item-groups",
    "items",
    "price-lists",
    "contract-discounts",
    "promotions",
    "orders",
    "inventory",
    "warehouses"
  ];
  const res = await makeRequest("PATCH", "/api/admin/roles/6", superToken, { permissions });
  console.log("Update role 6 response:", res);
}

run().catch(console.error);
