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

// We'll use this script once we implement the route logic
