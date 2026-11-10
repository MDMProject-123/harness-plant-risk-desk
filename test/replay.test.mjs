import assert from 'node:assert/strict';
import test from 'node:test';
import { replayShift } from '../lib/replay.mjs';
import { loadDemo } from '../lib/scenario.mjs';

const at = (clock) => `2026-01-15T${clock}:00.000Z`;

test('sample replay warns before impact, renews a slipped alert, and records overdue acknowledgement', () => {
  const report = replayShift(loadDemo());

  assert.deepEqual(report.notifications.map(({ issue, type, at: timestamp }) => [issue, type, timestamp]), [
    ['MNT-84', 'high_risk', at('09:00')],
    ['MNT-84', 'risk_worsened', at('09:15')],
    ['QA-29', 'high_risk', at('09:25')],
    ['MNT-84', 'resolved', at('09:45')],
    ['MAT-142', 'high_risk', at('10:00')],
    ['MAT-142', 'unacknowledged', at('10:10')],
  ]);

  const shortage = report.notifications.find(({ issue }) => issue === 'MAT-142');
  assert.equal(shortage.leadMinutes, 60);
  assert.equal(shortage.projectedImpactAt, at('11:00'));
  assert.deepEqual(shortage.recipients, ['Plant Manager', 'Logistics Manager']);
  assert.deepEqual(report.openActions.map(({ issue, status }) => [issue, status]), [
    ['MAT-142', 'acknowledged'],
    ['PLAN-17', 'watching'],
    ['QA-29', 'acknowledged'],
  ]);
});

test('a supply correction at the warning time prevents a false alert', () => {
  const scenario = loadDemo();
  const shortage = scenario.events.find(({ type }) => type === 'material');
  scenario.events = [shortage, {
    ...shortage,
    at: '2026-01-15T10:00:00Z',
    stockMinutes: 60,
    replenishmentAt: '2026-01-15T10:45:00Z',
    source: 'Corrected inbound ETA',
  }];
  const report = replayShift(scenario);
  assert.deepEqual(report.notifications, []);
  assert.deepEqual(report.openActions, []);
});

test('a blocked commitment is escalated once, even when a shift replay ends much later', () => {
  const scenario = loadDemo();
  scenario.events = [{ ...scenario.events[0], blocked: true }];
  scenario.asOf = '2026-01-15T14:00:00Z';
  const report = replayShift(scenario);

  assert.deepEqual(report.notifications.map(({ type, at: timestamp }) => [type, timestamp]), [
    ['high_risk', at('10:30')],
    ['unacknowledged', at('10:40')],
  ]);
  assert.equal(report.openActions[0].owner, 'Planning Manager');
  assert.equal(report.openActions[0].status, 'escalated');
});

test('near-term impact caps the acknowledgement deadline and an acknowledgement at the deadline is on time', () => {
  const scenario = loadDemo();
  const shortage = scenario.events.find(({ type }) => type === 'material');
  scenario.events = [
    { ...shortage, stockMinutes: 2 },
    { type: 'acknowledge', issue: shortage.issue, at: '2026-01-15T08:32:00Z',
      source: 'Logistics handover', by: 'Logistics Manager' },
  ];

  const { notifications, openActions } = replayShift(scenario);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].acknowledgeBy, at('08:32'));
  assert.equal(openActions[0].status, 'acknowledged');
});

test('moving a commitment outside the alert window returns it to watch and schedules a new alert', () => {
  const scenario = loadDemo();
  const commitment = { ...scenario.events[0], blocked: true, dueAt: '2026-01-15T09:00:00Z' };
  scenario.events = [commitment, {
    ...commitment,
    at: '2026-01-15T08:03:00Z',
    dueAt: '2026-01-15T11:55:00Z',
    source: 'Revised schedule',
  }];

  const report = replayShift(scenario);
  assert.deepEqual(report.notifications.map(({ type, at: timestamp }) => [type, timestamp]), [
    ['high_risk', at('08:00')],
    ['risk_cleared', at('08:03')],
    ['high_risk', at('10:55')],
  ]);
});

test('rejects bad timestamps and acknowledgements from an unrelated manager', () => {
  const malformed = loadDemo();
  malformed.events[0].at = '2026-02-30T08:00:00Z';
  assert.throws(() => replayShift(malformed), /events\[0\]\.at must use UTC/);

  const wrongManager = loadDemo();
  wrongManager.events.find(({ type }) => type === 'acknowledge').by = 'Quality Manager';
  assert.throws(() => replayShift(wrongManager), /not the owner or plant manager/);
});
