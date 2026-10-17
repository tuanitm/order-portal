import { NextRequest, NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set("admin-token", "", {
    httpOnly: true,
    expires: new Date(0),
    path: "/",
  });
  return response;
}

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/vi/admin", request.url));
  response.cookies.set("admin-token", "", {
    httpOnly: true,
    expires: new Date(0),
    path: "/",
  });
  return response;
}
