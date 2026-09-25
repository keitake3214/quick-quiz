// lib/firebaseAdmin.ts
import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";

let adminApp: App;

function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0];
  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY as string
  );
  adminApp = initializeApp({
    credential: cert(serviceAccount),
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  });
  return adminApp;
}

export function getAdminDb() {
  return getDatabase(getAdminApp());
}
