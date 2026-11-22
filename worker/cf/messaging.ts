// ============================================================================
// BUSAN HAK PORT INFO — Cloudflare Workers 어댑터
// firebase-admin/messaging 대체 (FCM HTTP v1)
// ============================================================================
import { getGoogleAccessToken, resolveProjectId, SCOPE } from './google-auth.js';

export interface MessagingMessage {
  token?: string;
  topic?: string;
  condition?: string;
  notification?: { title?: string; body?: string; imageUrl?: string };
  data?: Record<string, string>;
  android?: Record<string, any>;
  webpush?: Record<string, any>;
  apns?: Record<string, any>;
}

class Messaging {
  async send(message: MessagingMessage): Promise<string> {
    const token = await getGoogleAccessToken(SCOPE.firebaseMessaging);
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${resolveProjectId()}/messages:send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message })
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`fcm_send_failed:${res.status}:${text.slice(0, 300)}`);
    }
    const json = text ? JSON.parse(text) : {};
    return String(json.name || '');
  }

  async sendEachForMulticast(message: { tokens: string[]; notification?: any; data?: Record<string, string> }): Promise<{
    successCount: number;
    failureCount: number;
  }> {
    let successCount = 0;
    let failureCount = 0;
    for (const token of message.tokens || []) {
      try {
        await this.send({ token, notification: message.notification, data: message.data });
        successCount += 1;
      } catch {
        failureCount += 1;
      }
    }
    return { successCount, failureCount };
  }
}

let messaging: Messaging | null = null;

export function getMessaging(_app?: any): Messaging {
  if (!messaging) messaging = new Messaging();
  return messaging;
}
