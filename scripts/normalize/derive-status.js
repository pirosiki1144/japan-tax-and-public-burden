export const BURDEN_STATUSES = Object.freeze({
  NOT_APPLIED: "not_applied",
  ACTIVE: "active",
  ACTIVE_WITH_PENDING_CHANGE: "active_with_pending_change",
  ENDED: "ended"
});

function toDate(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${fieldName} is not a valid date: ${value}`);
  return date;
}

export function deriveBurdenStatus(phases, asOf = new Date()) {
  if (!Array.isArray(phases)) throw new TypeError("phases must be an array");
  const instant = toDate(asOf, "asOf");
  const normalized = phases.map((phase) => ({
    start: toDate(phase.application_start, "application_start"),
    end: toDate(phase.application_end, "application_end")
  }));

  const active = normalized.some(({ start, end }) => start !== null && start <= instant && (end === null || end >= instant));
  const future = normalized.some(({ start }) => start !== null && start > instant);

  if (active && future) return BURDEN_STATUSES.ACTIVE_WITH_PENDING_CHANGE;
  if (active) return BURDEN_STATUSES.ACTIVE;
  if (future) return BURDEN_STATUSES.NOT_APPLIED;
  return BURDEN_STATUSES.ENDED;
}
