import { iso, minute, parseScenario } from './scenario.mjs';

function riskFrom(event, rules) {
  const lead = rules.alertLeadMinutes * minute;
  switch (event.type) {
    case 'commitment':
      return {
        department: event.department,
        title: event.title,
        warnAt: event.dueAt - (event.blocked ? lead : 0),
        impact: event.dueAt,
        recovery: null,
        evidence: `${event.line}. ${event.blocked ? 'Reported blocked.' : 'Department commitment.'} Due at ${iso(event.dueAt)}.`,
      };
    case 'material': {
      const impact = event.at + event.stockMinutes * minute;
      if (event.replenishmentAt <= impact) return null;
      return {
        department: 'logistics',
        title: `${event.component} shortage on ${event.line}`,
        warnAt: impact - lead,
        impact,
        recovery: event.replenishmentAt,
        evidence: `${event.stockMinutes} minutes of stock at ${iso(event.at)}. Replenishment is due at ${iso(event.replenishmentAt)}.`,
      };
    }
    case 'downtime':
      if (event.recoveryAt <= event.latestRestartAt) return null;
      return {
        department: 'maintenance',
        title: `${event.machine} downtime on ${event.line} threatens a shipment`,
        warnAt: event.latestRestartAt - lead,
        impact: event.latestRestartAt,
        recovery: event.recoveryAt,
        evidence: `Repair ETA ${iso(event.recoveryAt)} is later than the latest restart needed to protect the shipment.`,
      };
    case 'quality':
      if (!event.held && event.failedTests < rules.qualityFailureThreshold) return null;
      return {
        department: 'quality',
        title: `Lot ${event.lot} ${event.held ? 'on hold' : 'needs quality review'} on ${event.line}`,
        warnAt: event.at,
        impact: event.shipmentCutoffAt,
        recovery: null,
        evidence: `${event.failedTests} failed tests. ${event.held ? 'Quality hold reported.' : 'Review threshold reached.'}`,
      };
  }
}

function updateReason(previous, risk, previousEvent, event) {
  if (risk.department !== previous.department) return 'The action has a new owner.';
  if (risk.impact < previous.impact) return 'The projected impact moved earlier.';
  if (risk.recovery !== null && previous.recovery !== null && risk.recovery > previous.recovery) {
    return `Recovery moved from ${iso(previous.recovery)} to ${iso(risk.recovery)}.`;
  }
  if (event.type === 'quality' && event.held && !previousEvent.held) return 'Quality reported a hold.';
  if (event.type === 'commitment' && event.blocked && !previousEvent.blocked) return 'The owner reported a blocker.';
  return null;
}

export function replayShift(input) {
  const { shift, startsAt, asOf, managers, rules, events } = parseScenario(input);
  const issues = new Map();
  const issueTypes = new Map();
  const notifications = [];
  const acknowledgeMs = rules.acknowledgeWithinMinutes * minute;

  function describe(issue) {
    return {
      issue: issue.id,
      title: issue.risk.title,
      department: issue.risk.department,
      owner: managers[issue.risk.department],
      projectedImpactAt: iso(issue.risk.impact),
      recoveryAt: issue.risk.recovery === null ? null : iso(issue.risk.recovery),
      nextAction: issue.event.nextAction,
      evidence: issue.risk.evidence,
      source: issue.event.source,
      observedAt: iso(issue.event.at),
    };
  }

  function emit(type, issue, at, reason, changeSource = issue.event.source) {
    notifications.push({
      ...describe(issue),
      type,
      at: iso(at),
      reason,
      changeSource,
      recipients: [...new Set([managers.plant, managers[issue.risk.department]])],
      acknowledgeBy: issue.deadline === null ? null : iso(issue.deadline),
      leadMinutes: Math.floor((issue.risk.impact - at) / minute),
    });
  }

  function startAlert(issue, at, reason = null) {
    issue.alertedAt ??= at;
    issue.deadline = at + acknowledgeMs;
    if (issue.risk.impact > at) issue.deadline = Math.min(issue.deadline, issue.risk.impact);
    issue.acknowledgedBy = null;
    issue.escalated = false;
    emit(reason ? 'risk_worsened' : 'high_risk', issue, at, reason ?? 'The configured alert rule was met.');
  }

  function advance(through) {
    while (true) {
      let next;
      for (const issue of issues.values()) {
        const due = issue.alertedAt === null
          ? Math.max(issue.risk.warnAt, issue.event.at)
          : issue.deadline;
        if (due !== null && due <= through && (!next || due < next.due)) {
          next = { issue, due };
        }
      }
      if (!next) return;

      const { issue, due } = next;
      if (issue.alertedAt === null) {
        startAlert(issue, due);
      } else {
        issue.deadline = null;
        issue.escalated = true;
        emit('unacknowledged', issue, due, 'The acknowledgement window expired. Plant manager intervention is needed.');
      }
    }
  }

  for (const event of events) {
    // An acknowledgement entered exactly at its deadline is on time.
    advance(event.at - 1);
    const current = issues.get(event.issue);

    if (event.type === 'acknowledge' || event.type === 'resolve') {
      if (!current || (event.type === 'acknowledge' && current.alertedAt === null)) {
        throw new Error(`${event.type} has no matching ${event.type === 'acknowledge' ? 'alert' : 'open issue'}: ${event.issue}`);
      }
      if (event.by !== managers.plant && event.by !== managers[current.risk.department]) {
        throw new Error(`${event.by} is not the owner or plant manager for ${event.issue}`);
      }
      current.deadline = null;
      if (event.type === 'acknowledge') {
        current.acknowledgedBy ??= event.by;
      } else {
        if (current.alertedAt !== null) {
          emit('resolved', current, event.at, `Closed by ${event.by}.`, event.source);
        }
        issues.delete(event.issue);
      }
      continue;
    }

    const priorType = issueTypes.get(event.issue);
    if (priorType && priorType !== event.type) {
      throw new Error(`Issue ${event.issue} changed category from ${priorType} to ${event.type}`);
    }
    issueTypes.set(event.issue, event.type);
    const risk = riskFrom(event, rules);
    if (!risk) {
      if (current && current.alertedAt !== null) {
        current.deadline = null;
        emit('risk_cleared', current, event.at, 'The latest observation cleared the alert condition.', event.source);
      }
      issues.delete(event.issue);
      continue;
    }

    const issue = current ?? {
      id: event.issue, alertedAt: null, deadline: null, acknowledgedBy: null, escalated: false,
    };
    const previous = current?.risk;
    const previousEvent = current?.event;
    issue.risk = risk;
    issue.event = event;
    issues.set(event.issue, issue);
    if (issue.alertedAt !== null && risk.warnAt > event.at) {
      issue.alertedAt = null;
      issue.deadline = null;
      issue.acknowledgedBy = null;
      issue.escalated = false;
      emit('risk_cleared', issue, event.at, 'The issue moved outside the alert window and remains on the watch list.');
    }
    if (issue.alertedAt === null && risk.warnAt <= event.at) {
      startAlert(issue, event.at);
    } else if (issue.alertedAt !== null && previous) {
      const reason = updateReason(previous, risk, previousEvent, event);
      if (reason) startAlert(issue, event.at, reason);
    }
  }
  advance(asOf);

  const openActions = [...issues.values()]
    .sort((left, right) => left.risk.impact - right.risk.impact)
    .map((issue) => ({
      ...describe(issue),
      status: issue.alertedAt === null ? 'watching' : issue.acknowledgedBy ? 'acknowledged'
        : issue.escalated ? 'escalated' : 'awaiting_acknowledgement',
      acknowledgedBy: issue.acknowledgedBy,
      acknowledgeBy: issue.deadline === null ? null : iso(issue.deadline),
    }));

  return {
    shift,
    startsAt: iso(startsAt),
    asOf: iso(asOf),
    delivery: 'simulated',
    notifications,
    openActions,
  };
}
