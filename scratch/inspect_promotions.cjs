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
  // Search for GTNO in promotions!
  const gtnoRes = await makeRequest("/api/admin/promotions?search=GTNO&limit=5", superToken);
  console.log("Search GTNO in promotions:", gtnoRes.total);
  if (gtnoRes.promotions && gtnoRes.promotions.length > 0) {
    console.log("GTNO promotion sample:", gtnoRes.promotions[0]);
  }

  // Search by bpCode=GTNO
  const bpRes = await makeRequest("/api/admin/promotions?bpCode=GTNO&limit=5", superToken);
  console.log("Search bpCode=GTNO:", bpRes.total);
  if (bpRes.promotions && bpRes.promotions.length > 0) {
    console.log("bpCode GTNO promotion sample:", bpRes.promotions[0]);
  }

  // Search for D1 or L1 in promotions
  const itemRes = await makeRequest("/api/admin/promotions?itemCode=D1&limit=5", superToken);
  console.log("Search itemCode=D1:", itemRes.total);
  if (itemRes.promotions && itemRes.promotions.length > 0) {
    console.log("itemCode D1 promotion sample:", itemRes.promotions[0]);
  }
}

run().catch(console.error);
