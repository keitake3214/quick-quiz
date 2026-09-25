// app/api/cron/cleanup-rooms/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebaseAdmin";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();
  const roomsSnap = await db.ref("rooms").get();

  if (!roomsSnap.exists()) {
    return NextResponse.json({ deleted: [], count: 0 });
  }

  const rooms = roomsSnap.val() as Record<string, any>;
  const deleted: string[] = [];

  for (const [roomId, room] of Object.entries(rooms)) {
    const users = room.users as Record<string, any> | undefined;

    // usersが空またはノードなし
    if (!users || Object.keys(users).length === 0) {
      await db.ref(`rooms/${roomId}`).remove();
      deleted.push(roomId);
      continue;
    }

    // 全員オフライン
    const allOffline = Object.values(users).every((u: any) => u.isOnline === false);
    if (allOffline) {
      await db.ref(`rooms/${roomId}`).remove();
      deleted.push(roomId);
    }
  }

  return NextResponse.json({ deleted, count: deleted.length });
}
