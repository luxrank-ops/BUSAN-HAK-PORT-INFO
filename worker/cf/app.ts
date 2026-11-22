// ============================================================================
// BUSAN HAK PORT INFO — Cloudflare Workers 어댑터
// firebase-admin/app 대체 (initializeApp · cert · getApps)
// ============================================================================
import { loadServiceAccountKey, resolveProjectId } from './google-auth.js';

export interface AppOptions {
  credential?: any;
  storageBucket?: string;
  projectId?: string;
}

class FirebaseApp {
  constructor(readonly options: AppOptions) {}
  name = '[DEFAULT]';
}

const apps: FirebaseApp[] = [];

export function cert(serviceAccount: any): { __serviceAccount: any } {
  return { __serviceAccount: serviceAccount };
}

export function initializeApp(options: AppOptions = {}): FirebaseApp {
  const key = (options.credential && options.credential.__serviceAccount) || loadServiceAccountKey();
  const app = new FirebaseApp({
    ...options,
    projectId: options.projectId || key?.project_id || resolveProjectId()
  });
  apps.length = 0;
  apps.push(app);
  return app;
}

export function getApps(): FirebaseApp[] {
  return apps;
}

export function getApp(): FirebaseApp {
  if (!apps.length) return initializeApp();
  return apps[0];
}

export function deleteApp(): Promise<void> {
  apps.length = 0;
  return Promise.resolve();
}
