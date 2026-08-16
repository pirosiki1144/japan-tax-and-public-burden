import test from "node:test";
import assert from "node:assert/strict";
import { BURDEN_STATUSES, deriveBurdenStatus } from "../scripts/normalize/derive-status.js";

const asOf = "2026-08-16";

test("future phase only is not applied", () => {
  assert.equal(deriveBurdenStatus([{ application_start: "2027-04-01", application_end: null }], asOf), BURDEN_STATUSES.NOT_APPLIED);
});

test("current phase only is active", () => {
  assert.equal(deriveBurdenStatus([{ application_start: "2020-04-01", application_end: null }], asOf), BURDEN_STATUSES.ACTIVE);
});

test("current and future phases indicate a pending change", () => {
  assert.equal(deriveBurdenStatus([
    { application_start: "2020-04-01", application_end: "2027-03-31" },
    { application_start: "2027-04-01", application_end: null }
  ], asOf), BURDEN_STATUSES.ACTIVE_WITH_PENDING_CHANGE);
});

test("past phases only have ended", () => {
  assert.equal(deriveBurdenStatus([{ application_start: "2020-04-01", application_end: "2025-03-31" }], asOf), BURDEN_STATUSES.ENDED);
});

test("empty phases have ended", () => {
  assert.equal(deriveBurdenStatus([], asOf), BURDEN_STATUSES.ENDED);
});

test("invalid dates are rejected", () => {
  assert.throws(() => deriveBurdenStatus([{ application_start: "not-a-date" }], asOf), TypeError);
});
