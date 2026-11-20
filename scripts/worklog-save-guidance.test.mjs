import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readAppJs, extractFunction } from './app-source.mjs';

const appJs = readAppJs();
const rosterJs = readFileSync(new URL('../public/js/roster-engine.js', import.meta.url), 'utf8');

test('save guidance scrolls the work-log save button into view', () => {
    const scrollToWorkLogSaveButton = extractFunction(appJs, 'scrollToWorkLogSaveButton');
    let scrollOptions = null;
    const context = vm.createContext({
        document: {
            getElementById(id) {
                assert.equal(id, 'saveLogBtn');
                return { scrollIntoView(options) { scrollOptions = options; } };
            }
        }
    });

    vm.runInContext(scrollToWorkLogSaveButton, context);
    context.scrollToWorkLogSaveButton();

    assert.deepEqual({ ...scrollOptions }, {
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
    });
});

test('wage calculator and roster save reminders both trigger the save-button scroll', () => {
    const appTransfer = appJs.slice(
        appJs.indexOf('async function sendCalculatedWageToLog()'),
        appJs.indexOf('async function sendWorkLogShipToWage()')
    );
    const rosterTransfer = rosterJs.slice(
        rosterJs.indexOf('function registerRosterResultToWorkLog('),
        rosterJs.indexOf('async function registerAllRosterResults(')
    );

    assert.match(appTransfer, /저장(?:을 눌러 기록하세요|하세요)[\s\S]*?scrollToWorkLogSaveButton\(\)/);
    assert.match(rosterTransfer, /저장(?:을 눌러 기록하세요)[\s\S]*?scrollToWorkLogSaveButton\(\)/);
});
