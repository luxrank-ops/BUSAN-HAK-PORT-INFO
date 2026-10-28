/**
 * 🔧 Firebase 배포 사전 점검·우회 도우미 회귀 테스트 (2026-10-28)
 *
 * 배경(운영 사고)
 *   배포용 서비스 계정에 `serviceusage.services.get` 권한이 없어
 *   Firebase CLI 의 "Firestore API 가 켜져 있나?" 확인 요청이 403 으로 거부되었고,
 *   그 결과 규칙 배포가 시작조차 못 해 운영에는 옛 규칙(기본 거부)이 남았습니다.
 *   → 화면에서는 "제출 실패: Missing or insufficient permissions".
 *
 * 이 파일이 지키는 것
 *   1) CLI 와 같은 경로의 configstore 캐시를 채운다(경로 규칙: XDG_CONFIG_HOME 우선)
 *   2) 기존 캐시 파일의 다른 값을 지우지 않는다(병합)
 *   3) 403 응답을 예외가 아니라 "안내 문장"으로 바꾼다
 *   4) 네트워크 오류도 배포를 죽이지 않는다
 *   5) 배포 워크플로우가 진단 → 캐시 주입 → 규칙 → 색인 → 호스팅 순서를 지킨다
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import {
    PROJECT_ID,
    RECOMMENDED_ROLE,
    buildSeededCache,
    checkService,
    describeCheckResults,
    resolveConfigStorePath,
    resolveServiceAccountEmail,
    seedCacheFile
} from './deploy-preflight.mjs';
import { readAppFile } from './app-source.mjs';

test('configstore 경로는 Firebase CLI 와 같다 (XDG_CONFIG_HOME 우선, 없으면 ~/.config)', () => {
    assert.equal(
        resolveConfigStorePath({ XDG_CONFIG_HOME: '/tmp/xdg' }, '/home/runner'),
        '/tmp/xdg/configstore/firebase-tools.json'
    );
    assert.equal(
        resolveConfigStorePath({}, '/home/runner'),
        '/home/runner/.config/configstore/firebase-tools.json'
    );
    // 빈 문자열/공백은 없는 것으로 취급합니다.
    assert.equal(
        resolveConfigStorePath({ XDG_CONFIG_HOME: '  ' }, '/home/runner'),
        '/home/runner/.config/configstore/firebase-tools.json'
    );
});

test('캐시 주입은 기존 값을 보존하며 firestore.googleapis.com 만 켠다', () => {
    const existing = {
        user: { email: 'luxrank@gmail.com' },
        apiEnablementCache: { 'other-project': { 'hosting.googleapis.com': true } }
    };
    const { data, added } = buildSeededCache(existing, PROJECT_ID, ['firestore.googleapis.com']);
    assert.deepEqual(added, ['firestore.googleapis.com']);
    assert.equal(data.apiEnablementCache[PROJECT_ID]['firestore.googleapis.com'], true);
    assert.equal(data.apiEnablementCache['other-project']['hosting.googleapis.com'], true, '다른 프로젝트 캐시를 지우면 안 됩니다');
    assert.equal(data.user.email, 'luxrank@gmail.com', '사용자 설정을 지우면 안 됩니다');
    // 원본은 건드리지 않습니다(순수 함수).
    assert.equal(existing.apiEnablementCache[PROJECT_ID], undefined);

    // 이미 켜져 있으면 added 가 비어 있습니다.
    assert.deepEqual(buildSeededCache(data, PROJECT_ID, ['firestore.googleapis.com']).added, []);
    // 캐시가 깨진 값이어도 복구합니다.
    assert.equal(buildSeededCache({ apiEnablementCache: 'broken' }, PROJECT_ID, ['firestore.googleapis.com']).data.apiEnablementCache[PROJECT_ID]['firestore.googleapis.com'], true);
});

test('캐시 파일을 실제로 쓰고, 깨진 JSON 이어도 다시 만든다', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preflight-'));
    const filePath = path.join(dir, 'configstore', 'firebase-tools.json');

    const first = seedCacheFile({ filePath });
    assert.equal(first.path, filePath);
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(parsed.apiEnablementCache[PROJECT_ID]['firestore.googleapis.com'], true);

    writeFileSync(filePath, '{ broken json');
    const second = seedCacheFile({ filePath });
    assert.deepEqual(second.added, ['firestore.googleapis.com']);
    assert.equal(JSON.parse(readFileSync(filePath, 'utf8')).apiEnablementCache[PROJECT_ID]['firestore.googleapis.com'], true);
});

test('서비스 상태 조회는 403 을 예외 없이 결과로 돌려준다', async () => {
    const denied = await checkService({
        token: 't',
        service: 'firestore.googleapis.com',
        fetchImpl: async () => ({
            ok: false,
            status: 403,
            json: async () => ({ error: { message: 'Permission denied to get service [firestore.googleapis.com]' } })
        })
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 403);
    assert.match(denied.message, /Permission denied/);

    const enabled = await checkService({
        token: 't',
        service: 'firestore.googleapis.com',
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ state: 'ENABLED' }) })
    });
    assert.equal(enabled.ok, true);
    assert.equal(enabled.state, 'ENABLED');

    // 네트워크 오류도 배포를 죽이지 않습니다.
    const boom = await checkService({
        token: 't',
        service: 'firestore.googleapis.com',
        fetchImpl: async () => { throw new Error('fetch failed'); }
    });
    assert.equal(boom.ok, false);
    assert.equal(boom.status, 0);
    assert.match(boom.message, /fetch failed/);
});

test('403 안내 문장은 서비스 계정 이메일과 부여할 역할을 알려 준다', () => {
    const text = describeCheckResults(
        [{ service: 'firestore.googleapis.com', status: 403, ok: false, message: 'Permission denied' }],
        { projectId: PROJECT_ID, serviceAccountEmail: 'deployer@busan-hak-port.iam.gserviceaccount.com' }
    );
    assert.match(text, /403/);
    assert.match(text, /serviceusage.services.get/);
    assert.ok(text.includes(RECOMMENDED_ROLE));
    assert.match(text, /deployer@busan-hak-port\.iam\.gserviceaccount\.com/);
    assert.match(text, /gcloud projects add-iam-policy-binding busan-hak-port/);

    // 정상일 때는 해결 방법 문구를 넣지 않습니다.
    const okText = describeCheckResults([{ service: 'firestore.googleapis.com', status: 200, ok: true, state: 'ENABLED' }]);
    assert.match(okText, /✅/);
    assert.doesNotMatch(okText, /해결 방법/);
});

test('배포 워크플로우는 진단 → 캐시 주입 → 규칙 → 색인 → 호스팅 순서로 실행한다', () => {
    const workflow = yaml.load(readAppFile('.github/workflows/deploy-firebase.yml'));
    const steps = workflow.jobs.deploy.steps.map((step) => step.name);
    const index = (name) => steps.findIndex((step) => String(step).includes(name));

    const authIndex = index('Google Cloud 인증');
    const diagnoseIndex = index('배포 권한 진단');
    const seedIndex = index('API 확인 캐시 주입');
    const rulesIndex = index('Firestore 보안 규칙 배포');
    const indexesIndex = index('Firestore 색인 배포');
    const hostingIndex = index('Firebase Hosting 배포');

    assert.ok(authIndex >= 0 && diagnoseIndex > authIndex, '인증 후에 진단해야 합니다');
    assert.ok(seedIndex > diagnoseIndex, '진단 후 캐시를 주입합니다');
    assert.ok(rulesIndex > seedIndex, '캐시 주입 후 규칙을 배포합니다');
    assert.ok(indexesIndex > rulesIndex && hostingIndex > indexesIndex, '규칙 → 색인 → 호스팅 순서를 지킵니다');

    // 진단·캐시 주입 단계는 실패해도 배포를 막지 않습니다(최선 노력 단계).
    const diagnose = workflow.jobs.deploy.steps[diagnoseIndex];
    const seed = workflow.jobs.deploy.steps[seedIndex];
    assert.equal(diagnose['continue-on-error'], true);
    assert.equal(seed['continue-on-error'], true);
    assert.match(String(diagnose.run), /deploy-preflight\.mjs check/);
    assert.match(String(seed.run), /deploy-preflight\.mjs seed-cache/);
});

test('배포 실패 안내는 캐시 우회와 IAM 역할 부여 방법을 함께 알려 준다', () => {
    const workflow = readAppFile('.github/workflows/deploy-firebase.yml');
    assert.match(workflow, /serviceusage\.serviceUsageConsumer/);
    assert.match(workflow, /Permission denied to get service/);
    assert.match(workflow, /gcloud projects add-iam-policy-binding/);
});

test('서비스 계정 이메일은 환경변수 → 자격 파일(client_email) 순서로 찾는다', () => {
    const readFile = () => JSON.stringify({
        type: 'service_account',
        client_email: 'deployer@busan-hak-port.iam.gserviceaccount.com',
        private_key: '절대출력금지'
    });
    assert.equal(resolveServiceAccountEmail({ DEPLOY_SERVICE_ACCOUNT_EMAIL: 'a@b.c' }, readFile), 'a@b.c');
    assert.equal(
        resolveServiceAccountEmail({ GOOGLE_APPLICATION_CREDENTIALS: '/tmp/creds.json' }, readFile),
        'deployer@busan-hak-port.iam.gserviceaccount.com'
    );
    assert.equal(resolveServiceAccountEmail({}, () => '{ broken'), '');
    assert.equal(resolveServiceAccountEmail({}, () => JSON.stringify({ type: 'service_account' })), '');
});

test('main 에 규칙 파일이 올라오면 자동으로 규칙을 배포하는 워크플로우가 있다', () => {
    // 2026-10-28: 수동 배포만 있다 보니 실행을 잊거나 권한 문제로 실패하면
    // 운영 규칙이 조용히 옛 버전으로 남아 "권한 거부" 증상이 반복되었습니다.
    const workflow = yaml.load(readAppFile('.github/workflows/deploy-rules-on-main.yml'));
    const trigger = workflow.on || workflow[true];
    assert.ok(trigger.push, 'push 트리거가 필요합니다');
    assert.deepEqual(trigger.push.branches, ['main']);
    assert.ok(
        trigger.push.paths.includes('firestore.rules'),
        'firestore.rules 가 바뀔 때 실행되어야 합니다'
    );
    assert.ok(trigger.workflow_dispatch, '수동 실행도 가능해야 합니다');

    const job = workflow.jobs['deploy-rules'];
    assert.equal(workflow.permissions.contents, 'read');
    // 배포 시크릿은 Production 환경에 있으므로 environment 를 지정해야 합니다.
    assert.equal(job.environment.name, 'Production');

    const steps = job.steps.map((step) => step.name);
    const order = ['규칙 정적 검사', 'Google Cloud 인증', '배포 권한 진단 (Service Usage)', 'API 확인 캐시 주입', 'Firestore 보안 규칙 배포'];
    let last = -1;
    for (const name of order) {
        const index = steps.findIndex((step) => step.includes(name));
        assert.ok(index > last, `${name} 단계의 순서가 잘못되었습니다`);
        last = index;
    }
    // 규칙만 배포해야 합니다(화면·색인은 별도 워크플로우 담당).
    const deployStep = job.steps.find((step) => step.name.includes('Firestore 보안 규칙 배포'));
    assert.match(String(deployStep.run), /--only firestore:rules --project busan-hak-port/);
    assert.doesNotMatch(String(deployStep.run), /hosting/);
});
