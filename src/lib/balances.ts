import type { Expense, ExpenseSplit, Settlement, Member, NetBalance, SimplifiedDebt, BalanceDetail } from '../types';

export function calculateNetBalances(
  expenses: (Expense & { expense_splits: ExpenseSplit[] })[],
  settlements: Settlement[],
  members: Member[]
): NetBalance[] {
  const balances = new Map<string, number>();
  const details = new Map<string, BalanceDetail[]>();

  for (const m of members) {
    balances.set(m.id, 0);
    details.set(m.id, []);
  }

  for (const exp of expenses) {
    if (exp.is_settlement) continue;

    const cur = balances.get(exp.paid_by) ?? 0;
    balances.set(exp.paid_by, cur + exp.amount_inr);

    const pd = details.get(exp.paid_by) ?? [];
    pd.push({
      expenseId: exp.id,
      description: exp.description,
      date: exp.date,
      amount: exp.amount_inr,
      currency: exp.currency,
      originalAmount: exp.original_amount,
    });
    details.set(exp.paid_by, pd);

    for (const split of exp.expense_splits) {
      const sc = balances.get(split.user_id) ?? 0;
      balances.set(split.user_id, sc - split.amount_owed);

      const sd = details.get(split.user_id) ?? [];
      sd.push({
        expenseId: exp.id,
        description: exp.description,
        date: exp.date,
        amount: -split.amount_owed,
        currency: exp.currency,
        originalAmount: exp.original_amount,
      });
      details.set(split.user_id, sd);
    }
  }

  for (const s of settlements) {
    const pb = balances.get(s.paid_by) ?? 0;
    balances.set(s.paid_by, pb + s.amount);

    const pt = balances.get(s.paid_to) ?? 0;
    balances.set(s.paid_to, pt - s.amount);

    const pd = details.get(s.paid_by) ?? [];
    pd.push({
      expenseId: s.id,
      description: `Settlement to ${members.find(m => m.id === s.paid_to)?.name ?? 'unknown'}`,
      date: s.date,
      amount: s.amount,
      currency: 'INR',
      originalAmount: null,
    });
    details.set(s.paid_by, pd);

    const ptd = details.get(s.paid_to) ?? [];
    ptd.push({
      expenseId: s.id,
      description: `Settlement from ${members.find(m => m.id === s.paid_by)?.name ?? 'unknown'}`,
      date: s.date,
      amount: -s.amount,
      currency: 'INR',
      originalAmount: null,
    });
    details.set(s.paid_to, ptd);
  }

  return members.map(m => ({
    userId: m.id,
    userName: m.name,
    netAmount: Math.round((balances.get(m.id) ?? 0) * 100) / 100,
    details: details.get(m.id) ?? [],
  }));
}

export function simplifyDebts(balances: NetBalance[]): SimplifiedDebt[] {
  const debtors:   { id: string; name: string; amount: number }[] = [];
  const creditors: { id: string; name: string; amount: number }[] = [];

  for (const b of balances) {
    if (b.netAmount < -0.01) debtors.push({ id: b.userId, name: b.userName, amount: Math.abs(b.netAmount) });
    else if (b.netAmount > 0.01) creditors.push({ id: b.userId, name: b.userName, amount: b.netAmount });
  }

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const debts: SimplifiedDebt[] = [];
  let i = 0, j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    if (amount > 0.01) {
      const db = balances.find(b => b.userId === debtors[i].id);
      const cb = balances.find(b => b.userId === creditors[j].id);
      debts.push({
        from: debtors[i].id,
        fromName: debtors[i].name,
        to: creditors[j].id,
        toName: creditors[j].name,
        amount: Math.round(amount * 100) / 100,
        details: [
          ...(db?.details ?? []).filter(d => d.amount < 0),
          ...(cb?.details ?? []).filter(d => d.amount > 0),
        ],
      });
    }
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount < 0.01) i++;
    if (creditors[j].amount < 0.01) j++;
  }

  return debts;
}
