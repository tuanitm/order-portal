const jwt = require("jsonwebtoken");
const http = require("http");

const JWT_SECRET = process.env.JWT_SECRET || "order-portal-secret-key-change-in-production";

function createToken(adminId, email, isSuperAdmin) {
  return jwt.sign({ adminId, email, isSuperAdmin }, JWT_SECRET, { expiresIn: "1h" });
}

function makeRequest(path, token) {
  return new Promise((resolve, reject) => {
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
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function run() {
  // Let's create a temporary test endpoint or inspect admins
  const admin3Token = createToken(7, "admin3@imv.com.vn", false);
  const res = await makeRequest("/api/admin/promotions?limit=5", admin3Token);
  console.log("Current admin3 promotions total:", res.total);
}

run().catch(console.error);
