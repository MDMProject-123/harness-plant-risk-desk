import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { replayShift } from './lib/replay.mjs';
import { loadDemo } from './lib/scenario.mjs';

function printReport(report) {
  const labels = {
    high_risk: 'HIGH RISK',
    risk_worsened: 'RISK UPDATE',
    unacknowledged: 'ESCALATED',
    risk_cleared: 'RISK CLEARED',
    resolved: 'RESOLVED',
  };
  const time = (stamp) => stamp.replace('T', ' ').replace('.000Z', ' UTC');
  console.log(`${report.shift} through ${time(report.asOf)}`);
  console.log('\nSimulated notifications');
  if (!report.notifications.length) console.log('  None');
  for (const item of report.notifications) {
    console.log(`  ${time(item.at)}  ${labels[item.type]}  [${item.issue}] ${item.title}`);
    if (item.type === 'resolved' || item.type === 'risk_cleared') {
      console.log(`    To ${item.recipients.join(', ')} | ${item.reason} [${item.changeSource}]`);
      continue;
    }
    const lead = item.leadMinutes >= 0
      ? `${item.leadMinutes} min before impact`
      : `${Math.abs(item.leadMinutes)} min past projected impact`;
    console.log(`    To ${item.recipients.join(', ')} | Projected impact ${time(item.projectedImpactAt)} (${lead})`);
    console.log(`    ${item.reason} ${item.evidence}`);
    if (item.acknowledgeBy) console.log(`    Acknowledge by ${time(item.acknowledgeBy)}`);
    console.log(`    Next action: ${item.nextAction} [${item.changeSource}]`);
  }
  console.log('\nOpen actions by time to impact');
  if (!report.openActions.length) console.log('  None');
  for (const item of report.openActions) {
    console.log(`  [${item.issue}] ${item.title} | ${item.owner} | ${item.status.replaceAll('_', ' ')}`);
    console.log(`    ${time(item.projectedImpactAt)} | ${item.nextAction}`);
  }
}

try {
  const { values, positionals } = parseArgs({
    options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log('Usage: node cli.mjs [shift.json] [--json]');
  } else {
    if (positionals.length > 1) throw new Error('Provide at most one shift JSON file');
    const scenario = positionals.length ? JSON.parse(readFileSync(positionals[0], 'utf8')) : loadDemo();
    const report = replayShift(scenario);
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else printReport(report);
  }
} catch (error) {
  console.error(`Replay failed: ${error.message}`);
  process.exitCode = 1;
}
