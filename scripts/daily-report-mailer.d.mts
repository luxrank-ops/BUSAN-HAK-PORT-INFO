/**
 * scripts/daily-report-mailer.mjs 타입 선언
 * ─────────────────────────────────────────────────────────────────────────────
 * server.ts(TypeScript, moduleResolution: NodeNext)가 런타임 구현체(.mjs)를
 * 그대로 임포트하면서도 `npm run typecheck` 를 통과하도록 타입만 제공합니다.
 * 구현과 선언이 어긋나면 CI(typecheck)가 실패하므로, 함수 시그니처를 바꿀 때는
 * 이 파일도 함께 갱신하세요.
 */

export interface InspectionEmailAttachment {
  filename: string;
  /** base64 인코딩된 본문 */
  content: string;
  contentType: string;
}

export interface InspectionEmailMessage {
  subject: string;
  text: string;
  html: string;
  attachments: InspectionEmailAttachment[];
  to: string[];
  from: string;
}

export interface ReportEmailConfig {
  enabled: boolean;
  mode: 'always' | 'alert';
  to: string[];
  from: string;
  attach: boolean;
}

export type MailTransport = 'resend' | 'gmail-api' | 'smtp' | null;

export interface ResolvedMailTransport {
  transport: MailTransport;
  reason: string | null;
  missing?: string[];
}

export interface SendReportEmailResult {
  ok: boolean;
  skipped: boolean;
  reason: string | null;
  transport: MailTransport;
  messageId: string | null;
  error: string | null;
}

export interface InspectionResultLike {
  kstDate: string;
  kstDateTime: string;
  generatedAt: string;
  checks: Array<{ category: string; name: string; status: 'PASS' | 'WARN' | 'FAIL'; detail: string; severity?: string }>;
  summary: { total: number; pass: number; warn: number; fail: number; overall: 'PASS' | 'WARN' | 'FAIL' };
}

export declare const DEFAULT_REPORT_EMAIL_TO: string;
export declare const SITE_LABEL: string;

export declare function resolveReportEmailConfig(env?: NodeJS.ProcessEnv): ReportEmailConfig;
export declare function resolveMailTransport(env?: NodeJS.ProcessEnv): ResolvedMailTransport;
export declare function buildInspectionSubject(result: InspectionResultLike): string;
export declare function buildInspectionText(result: InspectionResultLike): string;
export declare function buildInspectionHtml(result: InspectionResultLike): string;
export declare function buildInspectionEmail(options: {
  result: InspectionResultLike;
  markdown?: string;
  json?: unknown;
  config?: ReportEmailConfig;
  env?: NodeJS.ProcessEnv;
}): InspectionEmailMessage;
export declare function buildRfc822Message(message: {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: InspectionEmailAttachment[];
}): string;
export declare function sendInspectionReportEmail(options: {
  result: InspectionResultLike;
  markdown?: string;
  json?: unknown;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  nodemailer?: unknown;
  logger?: { log?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void };
}): Promise<SendReportEmailResult>;
