// lib/token-bridge.ts

// import {IS_USING_PRODUCTION} from '@/config/devconfig';
import { ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies";
import { NextResponse } from "next/server";

const bridge = new Map<
  string,
  {
    token: string;
    expiredAt: number;
  }
>();

export function saveToken(id: string, token: string, res: NextResponse) {
  bridge.set(id, {
    token,
    expiredAt: Date.now() + 5 * 60 * 1000,
  });
  res.cookies.set("bridge-id", id, {
    httpOnly: false,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 5,
  });
  res.cookies.set("token-ro", token, {
    httpOnly: false,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 5,
  });
}

export function getToken(id: string) {
  const item = bridge.get(id);

  if (!item) return null;

  if (Date.now() > item.expiredAt) {
    bridge.delete(id);
    return null;
  }

  return item.token;
}

export function removeToken(id: string, cookies?: ResponseCookies) {
  bridge.delete(id);
  cookies?.delete("bridge-id");
}

export function consumeToken(id: string) {
  const item = bridge.get(id);

  if (!item) {
    return null;
  }

  //   removeToken(id);

  if (Date.now() > item.expiredAt) {
    return null;
  }

  return item.token;
}
