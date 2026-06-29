import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(new URL(`/?error=line_auth_failed`, request.url));
  }

  const clientId = process.env.LINE_CHANNEL_ID!;
  const clientSecret = process.env.LINE_CHANNEL_SECRET!;
  const redirectUri = process.env.LINE_REDIRECT_URI!;

  // アクセストークン取得
  const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL(`/?error=token_fetch_failed`, request.url));
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  // プロフィール取得
  const profileRes = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!profileRes.ok) {
    return NextResponse.redirect(new URL(`/?error=profile_fetch_failed`, request.url));
  }

  const profile = await profileRes.json();

  // セッションクッキーにプロフィールを保存
  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(
    "line_user",
    JSON.stringify({
      userId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl || "",
    }),
    {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24, // 24時間
      path: "/",
    }
  );

  return response;
}
