import test from "node:test";
import assert from "node:assert/strict";
import { BURDEN_STATUSES, deriveBurdenStatus } from "../scripts/domain/derive-status.js";

const asOf = "2026-08-16";

test("future phase only is not applied", () => {
  assert.equal(deriveBurdenStatus([{ application_start: "2027-04-01", application_end: null }], asOf), BURDEN_STATUSES.NOT_APPLIED);
});

test("a phase is active on its application start date", () => {
  assert.equal(deriveBurdenStatus([{ application_start: asOf, application_end: null }], asOf), BURDEN_STATUSES.ACTIVE);
});

test("a phase remains active on its application end date", () => {
  assert.equal(deriveBurdenStatus([{ application_start: "2020-04-01", application_end: asOf }], asOf), BURDEN_STATUSES.ACTIVE);
});

test("a phase has ended on the day after its application end date", () => {
  assert.equal(deriveBurdenStatus([{ application_start: "2020-04-01", application_end: "2026-08-15" }], asOf), BURDEN_STATUSES.ENDED);
});

test("current and future phases indicate a pending change", () => {
  assert.equal(deriveBurdenStatus([
    { application_start: "2020-04-01", application_end: "2027-03-31" },
    { application_start: "2027-04-01", application_end: null }
  ], asOf), BURDEN_STATUSES.ACTIVE_WITH_PENDING_CHANGE);
});

test("a scheduled future end indicates a pending change", () => {
  assert.equal(deriveBurdenStatus([{ application_start: "2020-04-01", application_end: "2027-03-31" }], asOf), BURDEN_STATUSES.ACTIVE_WITH_PENDING_CHANGE);
});

test("empty phases cannot be classified as ended", () => {
  assert.throws(() => deriveBurdenStatus([], asOf), RangeError);
});

test("malformed and nonexistent dates are rejected", () => {
  assert.throws(() => deriveBurdenStatus([{ application_start: "not-a-date" }], asOf), TypeError);
  assert.throws(() => deriveBurdenStatus([{ application_start: "2026-02-30" }], asOf), TypeError);
});
