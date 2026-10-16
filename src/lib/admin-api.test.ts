import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEmployeePatch } from "./admin-api";

const profile = { employee_id: "0cf5f16a-6259-4819-8c69-6085418f2404", full_name: "John Kariuki", email: "john@example.com", role: "logistics_manager" };

test("editing details without is_active is a profile update", () => {
  const result = parseEmployeePatch(profile);
  assert.equal(result.action, "profile");
  assert.equal(result.data.employee_id, profile.employee_id);
});
test("full-row edits with is_active remain profile updates", () => {
  assert.equal(parseEmployeePatch({ ...profile, is_active: true }).action, "profile");
});
test("an access-only request remains an access toggle", () => {
  const result = parseEmployeePatch({ employee_id: profile.employee_id, is_active: false });
  assert.equal(result.action, "access");
  if (result.action === "access") assert.equal(result.data.is_active, false);
});
test("missing access flag is rejected rather than treated as an edit", () => {
  assert.throws(() => parseEmployeePatch({ employee_id: profile.employee_id }));
});