import { expect, it } from 'vitest';
import { RejectionAuditBudget } from './rejection-audit-budget.js';
it('bounds anonymous rows across repeated and rotating IPs, and resets next minute', () => {
  const budget = new RejectionAuditBudget();
  expect(budget.allow('same', 1)).toBe(true);
  expect(budget.allow('same', 2)).toBe(false);
  let accepted = 1;
  for (let i = 0; i < 10000; i++) if (budget.allow(`source-${i}`, 10)) accepted++;
  expect(accepted).toBe(60);
  expect(budget.allow('same', 60000)).toBe(true);
});
