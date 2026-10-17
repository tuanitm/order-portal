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
  const superToken = createToken(4, "admin@imv.com.vn", true);
  const roles = await makeRequest("/api/admin/roles", superToken);
  console.log("Roles:", JSON.stringify(roles, null, 2));

  const users = await makeRequest("/api/admin/users", superToken);
  console.log("Admin Users:", JSON.stringify(users, null, 2));
}

run().catch(console.error);
