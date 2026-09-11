import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionAttempt,
  canTransitionPayment,
  isActiveAttempt,
  isTerminalAttempt,
  paymentStatusForAttempt
} from "./payments.state";

test("payment attempt active and terminal sets are exhaustive", () => {
  assert.equal(isActiveAttempt("CREATED"), true);
  assert.equal(isActiveAttempt("PROCESSING"), true);
  for (const status of ["APPROVED", "REJECTED", "ERROR", "CANCELLED", "EXPIRED"] as const) {
    assert.equal(isTerminalAttempt(status), true);
    assert.equal(isActiveAttempt(status), false);
  }
});
test("payment attempt transition table allows only forward transitions", () => {
  assert.equal(canTransitionAttempt("CREATED", "PROCESSING"), true);
  assert.equal(canTransitionAttempt("PROCESSING", "APPROVED"), true);
  assert.equal(canTransitionAttempt("PROCESSING", "REJECTED"), true);
  assert.equal(canTransitionAttempt("APPROVED", "PROCESSING"), false);
  assert.equal(canTransitionAttempt("REJECTED", "APPROVED"), false);
  assert.equal(canTransitionAttempt("ERROR", "PROCESSING"), false);
});

test("payment transition table and attempt mapping preserve the domain boundary", () => {
  assert.equal(canTransitionPayment("PENDING", "PROCESSING"), true);
  assert.equal(canTransitionPayment("PROCESSING", "PENDING"), true);
  assert.equal(canTransitionPayment("PROCESSING", "PAID"), true);
  assert.equal(canTransitionPayment("PAID", "PENDING"), false);
  assert.equal(canTransitionPayment("CANCELLED", "PAID"), false);
  assert.equal(paymentStatusForAttempt("PROCESSING"), "PROCESSING");
  assert.equal(paymentStatusForAttempt("APPROVED"), "PAID");
  for (const status of ["CREATED", "REJECTED", "ERROR", "CANCELLED", "EXPIRED"] as const) {
    assert.equal(paymentStatusForAttempt(status), "PENDING");
  }
});
