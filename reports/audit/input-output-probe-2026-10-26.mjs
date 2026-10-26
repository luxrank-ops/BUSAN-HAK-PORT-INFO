// Read-only local reproductions. No Firebase writes or external requests.
// Run: node reports/audit/input-output-probe-2026-10-26.mjs
import vm from 'node:vm';
import { readAppJs, extractFunction } from '../../scripts/app-source.mjs';
const source = readAppJs();
const context = vm.createContext({
  getSeasonScheduleByMonth: () => ({ dayStart: 7, dayEnd: 17 }),
  isWeekendOrPublicHolidayDate: () => false,
  renderRow: () => '',
  getVesselScheduleDateTime: (_v, keys) => ({ date: '2026-10-26', time: keys[0] === 'ATA' ? '08:45' : '10:15' })
});
for (const name of ['calculateWageSegment', 'periodHours', 'getSelectedVesselPeriod']) {
  vm.runInContext(extractFunction(source, name), context);
}
const period = { startDate: '2026-10-26', endDate: '2026-10-26', startHour: 8, endHour: 9, hours: 1.5 };
const fractional = context.calculateWageSegment(period, { baseRate: 10320 });
const negative = context.calculateWageSegment({ ...period, hours: 1 }, { baseRate: -10320 });
console.log(JSON.stringify({
  fractionalHours: { input: 1.5, expectedPay: 15480, actualPay: fractional.totalPay, actualDayHours: fractional.dayHours },
  vesselMinutes: { arrival: '08:45', departure: '10:15', expectedHours: 1.5, actualHours: context.getSelectedVesselPeriod({}).hours },
  negativeRate: { input: -10320, expected: 'reject', actualPay: negative.totalPay },
  csvFormula: { input: '=1+1', actualCell: `"${'=1+1'.replace(/"/g, '""')}"`, expected: 'neutralize spreadsheet formula' }
}, null, 2));
