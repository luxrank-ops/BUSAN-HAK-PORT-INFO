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

export interface SendResponse {
  success: boolean;
  messageId?: string;
  error?: { code: string; message: string };
}

function mapFcmErrorCode(status: number, bodyText: string): string {
  if (/UNREGISTERED/i.test(bodyText)) return 'messaging/registration-token-not-registered';
  if (/INVALID_ARGUMENT/i.test(bodyText)) return 'messaging/invalid-argument';
  if (/SENDER_ID_MISMATCH/i.test(bodyText)) return 'messaging/mismatched-credential';
  if (/QUOTA_EXCEEDED/i.test(bodyText)) return 'messaging/message-rate-exceeded';
  if (status === 401 || status === 403) return 'messaging/authentication-error';
  if (status >= 500) return 'messaging/internal-error';
  return 'messaging/unknown-error';
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
      const err: any = new Error(`fcm_send_failed:${res.status}:${text.slice(0, 300)}`);
      err.code = mapFcmErrorCode(res.status, text);
      throw err;
    }
    const json = text ? JSON.parse(text) : {};
    return String(json.name || '');
  }

  async sendEachForMulticast(message: {
    tokens: string[];
    notification?: MessagingMessage['notification'];
    data?: Record<string, string>;
    android?: Record<string, any>;
    webpush?: Record<string, any>;
    apns?: Record<string, any>;
  }): Promise<{
    successCount: number;
    failureCount: number;
    responses: SendResponse[];
  }> {
    const tokens = Array.isArray(message.tokens) ? message.tokens : [];
    const responses: SendResponse[] = new Array(tokens.length);
    let successCount = 0;
    let failureCount = 0;

    // 동시성 10으로 제한해 CF Worker 서브요청·지연 한도 내에서 병렬 전송합니다.
    const CONCURRENCY = 10;
    for (let offset = 0; offset < tokens.length; offset += CONCURRENCY) {
      const slice = tokens.slice(offset, offset + CONCURRENCY);
      await Promise.all(slice.map(async (token, idx) => {
        try {
          const messageId = await this.send({
            token,
            notification: message.notification,
            data: message.data,
            android: message.android,
            webpush: message.webpush,
            apns: message.apns
          });
          responses[offset + idx] = { success: true, messageId };
          successCount += 1;
        } catch (err: any) {
          responses[offset + idx] = {
            success: false,
            error: {
              code: String(err?.code || 'messaging/unknown-error'),
              message: String(err?.message || err)
            }
          };
          failureCount += 1;
        }
      }));
    }

    return { successCount, failureCount, responses };
  }
}

let messaging: Messaging | null = null;

export function getMessaging(_app?: any): Messaging {
  if (!messaging) messaging = new Messaging();
  return messaging;
}
