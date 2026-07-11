import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { saveToken } from "../../../lib/token-bridge";


function getCorsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Client-Id",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");

  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const token = req.headers.get("authorization");

  if (!token) {
    return NextResponse.json(
      {
        message: "Unauthorized",
      },
      {
        status: 401,
        headers: getCorsHeaders(origin),
      },
    );
  }

  const bridgeId = randomUUID();

  const res = NextResponse.json(
    {
      success: true,
      data: {
        url: `${req.nextUrl.origin}/retail-outlet`,
        bridgeId,
      },
    },
    {
      headers: getCorsHeaders(origin),
    },
  );

  saveToken(bridgeId, token, res);

  return res;
}