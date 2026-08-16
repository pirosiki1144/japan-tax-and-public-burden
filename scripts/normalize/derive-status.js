export const BURDEN_STATUSES = Object.freeze({
  NOT_APPLIED: "not_applied",
  ACTIVE: "active",
  ACTIVE_WITH_PENDING_CHANGE: "active_with_pending_change",
  ENDED: "ended"
});

function toDate(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError(`${fieldName} is not a valid date`);
    return value;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${fieldName} is not a valid ISO date: ${value}`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new TypeError(`${fieldName} is not a real calendar date: ${value}`);
  }
  return date;
}

export function deriveBurdenStatus(phases, asOf = new Date()) {
  if (!Array.isArray(phases)) throw new TypeError("phases must be an array");
  if (phases.length === 0) throw new RangeError("status cannot be derived without at least one phase");
  const instant = toDate(asOf, "asOf");
  const normalized = phases.map((phase) => ({
    start: toDate(phase.application_start, "application_start"),
    end: toDate(phase.application_end, "application_end")
  }));

  const active = normalized.some(({ start, end }) => start !== null && start <= instant && (end === null || end >= instant));
  const futureStart = normalized.some(({ start }) => start !== null && start > instant);
  const futureEnd = normalized.some(({ start, end }) => start !== null && start <= instant && end !== null && end > instant);

  if (active && (futureStart || futureEnd)) return BURDEN_STATUSES.ACTIVE_WITH_PENDING_CHANGE;
  if (active) return BURDEN_STATUSES.ACTIVE;
  if (futureStart) return BURDEN_STATUSES.NOT_APPLIED;
  return BURDEN_STATUSES.ENDED;
}
