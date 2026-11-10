import demo from '../examples/demo-shift.json' with { type: 'json' };

export const minute = 60_000;
export const iso = (timestamp) => new Date(timestamp).toISOString();

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function string(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a nonempty string`);
  }
  return value.trim();
}

function integer(value, field, min = 0) {
  if (!Number.isSafeInteger(value) || value < min || value > 1_000_000) {
    throw new Error(`${field} must be an integer from ${min} to 1000000`);
  }
  return value;
}

function time(value, field) {
  const timestamp = typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)
    ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp) || iso(timestamp).replace('.000Z', 'Z') !== value) {
    throw new Error(`${field} must use UTC with seconds, e.g. 2026-01-15T09:00:00Z`);
  }
  return timestamp;
}

function forecastTime(value, field, observedAt) {
  const timestamp = time(value, field);
  if (timestamp < observedAt) throw new Error(`${field} must be at or after the observation time`);
  return timestamp;
}

export function parseEvent(raw, field = 'event') {
  const data = object(raw, field);
  const event = {
    type: string(data.type, `${field}.type`),
    issue: string(data.issue, `${field}.issue`),
    at: time(data.at, `${field}.at`),
    source: string(data.source, `${field}.source`),
  };

  if (event.type === 'acknowledge' || event.type === 'resolve') {
    return { ...event, by: string(data.by, `${field}.by`) };
  }

  const observation = {
    ...event,
    line: string(data.line, `${field}.line`),
    nextAction: string(data.nextAction, `${field}.nextAction`),
  };
  switch (event.type) {
    case 'commitment':
      if (!['production', 'planning', 'logistics', 'maintenance', 'quality'].includes(data.department)) {
        throw new Error(`${field}.department must be a managed department`);
      }
      if (typeof data.blocked !== 'boolean') {
        throw new Error(`${field}.blocked must be true or false`);
      }
      return {
        ...observation,
        title: string(data.title, `${field}.title`),
        department: data.department,
        blocked: data.blocked,
        dueAt: time(data.dueAt, `${field}.dueAt`),
      };
    case 'material':
      return {
        ...observation,
        component: string(data.component, `${field}.component`),
        stockMinutes: integer(data.stockMinutes, `${field}.stockMinutes`),
        replenishmentAt: forecastTime(data.replenishmentAt, `${field}.replenishmentAt`, event.at),
      };
    case 'downtime':
      return {
        ...observation,
        machine: string(data.machine, `${field}.machine`),
        latestRestartAt: time(data.latestRestartAt, `${field}.latestRestartAt`),
        recoveryAt: forecastTime(data.recoveryAt, `${field}.recoveryAt`, event.at),
      };
    case 'quality':
      if (typeof data.held !== 'boolean') {
        throw new Error(`${field}.held must be true or false`);
      }
      return {
        ...observation,
        lot: string(data.lot, `${field}.lot`),
        failedTests: integer(data.failedTests, `${field}.failedTests`),
        held: data.held,
        shipmentCutoffAt: time(data.shipmentCutoffAt, `${field}.shipmentCutoffAt`),
      };
    default:
      throw new Error(`${field}.type is unknown: ${event.type}`);
  }
}

export function parseScenario(input) {
  const data = object(input, 'scenario');
  const managers = object(data.managers, 'managers');
  const rules = object(data.rules, 'rules');
  const startsAt = time(data.startsAt, 'startsAt');
  const asOf = time(data.asOf, 'asOf');
  if (asOf < startsAt) throw new Error('asOf must be at or after startsAt');
  if (!Array.isArray(data.events)) throw new Error('events must be an array');

  return {
    shift: string(data.shift, 'shift'),
    startsAt,
    asOf,
    managers: {
      plant: string(managers.plant, 'managers.plant'),
      production: string(managers.production, 'managers.production'),
      planning: string(managers.planning, 'managers.planning'),
      logistics: string(managers.logistics, 'managers.logistics'),
      maintenance: string(managers.maintenance, 'managers.maintenance'),
      quality: string(managers.quality, 'managers.quality'),
    },
    rules: {
      alertLeadMinutes: integer(rules.alertLeadMinutes, 'rules.alertLeadMinutes', 1),
      acknowledgeWithinMinutes: integer(rules.acknowledgeWithinMinutes, 'rules.acknowledgeWithinMinutes', 1),
      qualityFailureThreshold: integer(rules.qualityFailureThreshold, 'rules.qualityFailureThreshold', 1),
    },
    events: data.events.map((raw, index) => {
      const event = parseEvent(raw, `events[${index}]`);
      if (event.at < startsAt || event.at > asOf) {
        throw new Error(`events[${index}].at must be inside the replay window`);
      }
      return event;
    }).sort((left, right) => left.at - right.at),
  };
}

export function loadDemo() {
  return structuredClone(demo);
}
