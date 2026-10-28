// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/**
 * 🔧 Firebase 운영 배포 사전 점검 · 우회 도우미 (2026-10-28)
 *
 * 왜 필요한가
 *   `firebase deploy --only firestore:rules` 는 배포 전에
 *   Service Usage API(serviceusage.googleapis.com)로 "Firestore API 가 켜져 있는지"를 확인합니다.
 *   배포용 서비스 계정에 `serviceusage.services.get` 권한이 없으면 그 확인 요청이
 *   403 (Permission denied to get service [firestore.googleapis.com]) 으로 거부되어
 *   **규칙 배포 자체가 시작도 못 하고** 끝납니다.
 *   (실제 운영 사고: 2026-10-26 ~ 10-28 규칙이 계속 옛 버전으로 남아
 *    "제출 실패: Missing or insufficient permissions" 발생)
 *
 * 이 스크립트가 하는 일
 *   1) check  : 서비스 계정 토큰으로 서비스 상태 조회가 되는지 진단하고, 안 되면
 *               "누가 무엇을 하면 되는지" 를 한국어로 안내합니다. (항상 exit 0 = 진단용)
 *   2) seed-cache : 권한이 없어도 배포가 진행되도록 Firebase CLI 의 API 확인 캐시를 채웁니다.
 *               CLI 는 `~/.config/configstore/firebase-tools.json` 의
 *               `apiEnablementCache[projectId][apiName]` 가 true 면 확인 요청을 생략합니다.
 *               (권한 검사를 없애는 것이 아니라, 이미 켜져 있는 API 를 매번 조회하지 않게 하는
 *                CLI 의 공식 캐시 동작을 미리 채우는 것입니다. 실제 쓰기 권한은 그대로 검사됩니다.)
 *
 * 사용 예
 *   node scripts/deploy-preflight.mjs check --token="$TOKEN"
 *   node scripts/deploy-preflight.mjs seed-cache
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

/** 운영 프로젝트 ID (firebase.json · firebase-blueprint.json 과 동일) */
export const PROJECT_ID = 'busan-hak-port';

/** 배포 전에 상태를 확인하는 API 목록 — CLI(firestore prepare)가 조회하는 값과 같습니다. */
export const CHECKED_SERVICES = ['firestore.googleapis.com', 'firebaserules.googleapis.com'];

const SERVICE_USAGE_ORIGIN = 'https://serviceusage.googleapis.com';

/** 서비스 계정에 없을 때 안내할 역할 */
export const RECOMMENDED_ROLE = 'roles/serviceusage.serviceUsageConsumer';

/**
 * Firebase CLI(configstore) 캐시 파일 경로를 계산합니다.
 * configstore 는 XDG_CONFIG_HOME 을 우선하고, 없으면 ~/.config 를 씁니다.
 */
export function resolveConfigStorePath(env = process.env, home = homedir()) {
    const xdg = String(env.XDG_CONFIG_HOME || '').trim();
    const base = xdg || path.join(home, '.config');
    return path.join(base, 'configstore', 'firebase-tools.json');
}

/**
 * 기존 캐시 파일을 보존한 채 API 확인 캐시만 채웁니다(순수 함수 — 파일 쓰기는 호출부).
 * @returns {{ data: object, added: string[] }}
 */
export function buildSeededCache(existingData, projectId, services) {
    const data = existingData && typeof existingData === 'object' ? { ...existingData } : {};
    const cache = data.apiEnablementCache && typeof data.apiEnablementCache === 'object'
        ? { ...data.apiEnablementCache }
        : {};
    const projectCache = cache[projectId] && typeof cache[projectId] === 'object'
        ? { ...cache[projectId] }
        : {};
    const added = [];
    for (const service of services || CHECKED_SERVICES) {
        if (projectCache[service] !== true) {
            projectCache[service] = true;
            added.push(service);
        }
    }
    cache[projectId] = projectCache;
    data.apiEnablementCache = cache;
    return { data, added };
}

/** 캐시 파일을 갱신하고 결과를 돌려줍니다(디스크 입출력 담당). */
export function seedCacheFile({ filePath, projectId = PROJECT_ID, services = CHECKED_SERVICES } = {}) {
    const target = filePath || resolveConfigStorePath();
    let existing = {};
    if (existsSync(target)) {
        try {
            existing = JSON.parse(readFileSync(target, 'utf8'));
        } catch (_) {
            // 깨진 캐시는 새로 씁니다.
            existing = {};
        }
    }
    const { data, added } = buildSeededCache(existing, projectId, services);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(data, null, '\t')}\n`, { mode: 0o600 });
    try {
        chmodSync(target, 0o600);
    } catch (_) {
        // 권한 변경 실패는 무시(읽기 전용 마운트 등)
    }
    return { path: target, added };
}

/** 서비스 하나의 상태를 조회합니다. 네트워크·권한 문제도 예외 대신 결과로 돌려줍니다. */
export async function checkService({ token, projectId = PROJECT_ID, service, fetchImpl = fetch }) {
    const url = `${SERVICE_USAGE_ORIGIN}/v1/projects/${projectId}/services/${service}`;
    try {
        const response = await fetchImpl(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                'x-goog-quota-user': `projects/${projectId}`
            }
        });
        let body = null;
        try {
            body = await response.json();
        } catch (_) {
            body = null;
        }
        return {
            service,
            status: response.status,
            ok: response.ok,
            state: body && body.state ? String(body.state) : '',
            message: body && body.error && body.error.message ? String(body.error.message) : ''
        };
    } catch (error) {
        return { service, status: 0, ok: false, state: '', message: String((error && error.message) || error) };
    }
}

/** 진단 결과를 사람이 읽을 수 있는 안내 문장으로 만듭니다(순수 함수). */
export function describeCheckResults(results, { projectId = PROJECT_ID, serviceAccountEmail = '' } = {}) {
    const lines = [];
    const denied = (results || []).filter((entry) => entry.status === 403);
    const failed = (results || []).filter((entry) => !entry.ok && entry.status !== 403);
    const okList = (results || []).filter((entry) => entry.ok);

    for (const entry of okList) {
        lines.push(`✅ ${entry.service} 상태 조회 성공 (${entry.state || '상태 미표시'})`);
    }
    for (const entry of denied) {
        lines.push(`⚠️ ${entry.service} 상태 조회 403 — 서비스 계정에 serviceusage.services.get 권한이 없습니다.`);
    }
    for (const entry of failed) {
        lines.push(`⚠️ ${entry.service} 상태 조회 실패 (HTTP ${entry.status}${entry.message ? ` · ${entry.message}` : ''})`);
    }
    if (denied.length || failed.length) {
        lines.push('');
        lines.push('해결 방법 (둘 중 하나):');
        lines.push(`1) 서비스 계정에 역할 부여 — 프로젝트 ${projectId}`);
        lines.push('   GCP 콘솔 → IAM 및 관리자 → 액세스 권한 부여 → 새 주 구성원에 아래 이메일 입력');
        lines.push(`   주 구성원: ${serviceAccountEmail || '(Firebase 서비스 계정 이메일 — 시크릿 JSON 의 client_email)'}`);
        lines.push(`   역할: Service Usage 소비자 (${RECOMMENDED_ROLE})`);
        lines.push('   또는 터미널에서:');
        lines.push(`   gcloud projects add-iam-policy-binding ${projectId} \\`);
        lines.push(`     --member="serviceAccount:${serviceAccountEmail || '<서비스 계정 이메일>'}" \\`);
        lines.push(`     --role="${RECOMMENDED_ROLE}"`);
        lines.push('2) 필요한 API 가 꺼져 있다면 활성화합니다:');
        lines.push(`   gcloud services enable firestore.googleapis.com firebaserules.googleapis.com --project ${projectId}`);
        lines.push('3) 이 워크플로우의 "API 확인 캐시 주입" 단계가 자동으로 우회합니다.');
        lines.push('   (CLI 가 매번 하는 "API 켜져 있나?" 조회만 생략합니다. 쓰기 권한은 그대로 검사됩니다.)');
    }
    return lines.join('\n');
}

/** base64url 인코딩(JWT 구성 요소) */
function base64Url(input) {
    return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * 서비스 계정 키로 OAuth 액세스 토큰을 직접 발급합니다(JWT Bearer 흐름).
 *
 * 왜 직접 만드나: google-github-actions/auth 의 `token_format: access_token` 은
 * IAM Service Account Credentials API(iamcredentials.googleapis.com)가 켜져 있어야 하는데,
 * 이 프로젝트에서는 그 API 가 꺼져 있어 인증 단계 자체가 403 으로 실패했습니다(2026-10-28).
 * JWT Bearer 흐름은 oauth2.googleapis.com 만 있으면 되므로 추가 API 활성화가 필요 없습니다.
 */
export async function getAccessTokenFromServiceAccount({ credentials, fetchImpl = fetch, nowMs = Date.now() }) {
    const creds = typeof credentials === 'string' ? JSON.parse(credentials) : (credentials || {});
    if (!creds.client_email || !creds.private_key) {
        throw new Error('서비스 계정 키에 client_email/private_key 가 없습니다');
    }
    const issuedAt = Math.floor(nowMs / 1000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(JSON.stringify({
        iss: creds.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        iat: issuedAt,
        exp: issuedAt + 3600
    }));
    const signature = crypto.createSign('RSA-SHA256')
        .update(`${header}.${claims}`)
        .sign(creds.private_key);
    const assertion = `${header}.${claims}.${base64Url(signature)}`;

    const response = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || !body.access_token) {
        const message = body && (body.error_description || body.error) ? `${body.error || ''} ${body.error_description || ''}`.trim() : `HTTP ${response.status}`;
        throw new Error(`액세스 토큰 발급 실패: ${message}`);
    }
    return String(body.access_token);
}

/**
 * 서비스 계정 이메일을 찾습니다.
 *  1) DEPLOY_SERVICE_ACCOUNT_EMAIL 환경변수
 *  2) google-github-actions/auth 가 만든 자격 파일(GOOGLE_APPLICATION_CREDENTIALS)의 client_email
 * 키 본문은 절대 출력하지 않고 이메일만 사용합니다.
 */
export function resolveServiceAccountEmail(env = process.env, readFile = readFileSync) {
    const direct = String(env.DEPLOY_SERVICE_ACCOUNT_EMAIL || '').trim();
    if (direct) return direct;
    const file = String(env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
    if (!file) return '';
    try {
        const parsed = JSON.parse(readFile(file, 'utf8'));
        return String((parsed && parsed.client_email) || '').trim();
    } catch (_) {
        return '';
    }
}

/** GitHub Actions 요약 파일에 남깁니다(로컬 실행에서는 그냥 콘솔). */
function writeSummary(text, env = process.env) {
    console.log(text);
    const file = String(env.GITHUB_STEP_SUMMARY || '').trim();
    if (!file) return;
    try {
        writeFileSync(file, `${text}\n`, { flag: 'a' });
    } catch (_) {
        // 요약 파일을 못 쓰면 콘솔 출력으로 충분합니다.
    }
}

async function main(argv = process.argv.slice(2)) {
    const command = String(argv[0] || '').trim();
    const tokenArg = argv.find((arg) => arg.startsWith('--token='));
    const token = tokenArg ? tokenArg.slice('--token='.length) : String(process.env.GOOGLE_OAUTH_ACCESS_TOKEN || '');
    const saEmail = resolveServiceAccountEmail();

    if (command === 'seed-cache') {
        const result = seedCacheFile({ projectId: PROJECT_ID });
        const added = result.added.length ? result.added.join(', ') : '(이미 채워져 있음)';
        writeSummary([
            '### 🔧 Firebase CLI API 확인 캐시 주입',
            '',
            `- 파일: \`${result.path}\``,
            `- 프로젝트: \`${PROJECT_ID}\``,
            `- 추가: ${added}`,
            '',
            '이 단계는 "API 가 켜져 있는지 매번 조회"하는 CLI 동작만 생략합니다.',
            '실제 규칙/색인 쓰기 권한은 Firebase 가 그대로 검사합니다.'
        ].join('\n'));
        return 0;
    }

    if (command === 'check') {
        let accessToken = token;
        const notes = [];
        if (!accessToken) {
            const file = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
            if (file && existsSync(file)) {
                try {
                    accessToken = await getAccessTokenFromServiceAccount({ credentials: readFileSync(file, 'utf8') });
                } catch (error) {
                    notes.push(`액세스 토큰을 발급하지 못해 진단을 건너뜁니다: ${String((error && error.message) || error)}`);
                }
            } else {
                notes.push('서비스 계정 자격 파일이 없어 진단을 건너뜁니다.');
            }
        }
        if (!accessToken) {
            writeSummary([
                '### ⚠️ 배포 권한 진단 건너뜀',
                '',
                ...notes.map((note) => `- ${note}`),
                '',
                '배포는 그대로 진행됩니다(진단은 참고용).'
            ].join('\n'));
            return 0;
        }
        if (notes.length) {
            writeSummary(`### 🔎 배포 권한 진단\n\n${notes.map((note) => `- ${note}`).join('\n')}`);
        }
        const results = [];
        for (const service of CHECKED_SERVICES) {
            results.push(await checkService({ token: accessToken, projectId: PROJECT_ID, service }));
        }
        const summary = describeCheckResults(results, { projectId: PROJECT_ID, serviceAccountEmail: saEmail });
        writeSummary(`### 🔎 Firebase 배포 권한 진단\n\n\`\`\`\n${summary}\n\`\`\``);
        // 진단은 실패시키지 않습니다(우회 경로가 있으므로). 결과는 요약에 남깁니다.
        return 0;
    }

    console.error('사용법: node scripts/deploy-preflight.mjs <check|seed-cache> [--token=<OAuth 토큰>]');
    return 2;
}

const invokedDirectly = (() => {
    try {
        return process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
    } catch (_) {
        return false;
    }
})();

if (invokedDirectly) {
    main().then((code) => {
        process.exitCode = code;
    }).catch((error) => {
        console.error('[deploy-preflight] 예기치 못한 오류:', error && error.message ? error.message : error);
        process.exitCode = 1;
    });
}
