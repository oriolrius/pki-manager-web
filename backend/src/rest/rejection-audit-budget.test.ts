import { expect, it } from 'vitest';
import { RejectionAuditBudget, type DroppedRejections } from './rejection-audit-budget.js';
it('bounds anonymous rows across repeated and rotating IPs, and resets next minute', () => {
  const budget = new RejectionAuditBudget();
  expect(budget.allow('same', 1)).toBe(true);
  expect(budget.allow('same', 2)).toBe(false);
  let accepted = 1;
  for (let i = 0; i < 10000; i++) if (budget.allow(`source-${i}`, 10)) accepted++;
  expect(accepted).toBe(60);
  expect(budget.allow('same', 60000)).toBe(true);
});
it('reports each window with dropped rows exactly once, including through roll()', () => {
  const reports: DroppedRejections[] = [];
  const budget = new RejectionAuditBudget((summary) => reports.push(summary));
  budget.allow('a', 1_000);
  budget.allow('a', 2_000);
  budget.allow('a', 3_000);
  expect(reports).toEqual([]);
  budget.roll(59_999);
  expect(reports).toEqual([]);
  budget.roll(60_000); // timer closes the window without a new request
  expect(reports).toEqual([{ windowStart: new Date(0), dropped: 2 }]);
  budget.allow('b', 61_000);
  budget.roll(120_000); // a window without drops is not reported
  budget.roll(130_000);
  expect(reports).toHaveLength(1);
});
