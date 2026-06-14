export interface User {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

export interface Group {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
}

/** A group participant — may or may not have an auth account. */
export interface Member {
  id: string;          // members.id (UUID) — used in expense_splits, expenses.paid_by
  group_id: string;
  name: string;
  user_id: string | null;  // null for virtual/name-only members
  joined_at: string;
  left_at: string | null;
}

/** Still used for RLS access-control (who can see a group). */
export interface GroupMembership {
  id: string;
  group_id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
}

export interface Expense {
  id: string;
  group_id: string;
  description: string;
  amount_inr: number;
  original_amount: number | null;
  currency: string;
  exchange_rate: number;
  paid_by: string;       // members.id
  date: string;
  split_type: 'equal' | 'unequal' | 'percentage' | 'share';
  is_settlement: boolean;
  created_at: string;
  member?: Member;       // joined: the payer
}

export interface ExpenseSplit {
  id: string;
  expense_id: string;
  user_id: string;       // members.id (column kept as user_id for compatibility)
  amount_owed: number;
  share_weight: number | null;
  percentage: number | null;
  fixed_amount: number | null;
  member?: Member;       // joined: the participant
}

export interface Settlement {
  id: string;
  group_id: string;
  paid_by: string;       // members.id
  paid_to: string;       // members.id
  amount: number;
  date: string;
  created_at: string;
  payer?: Member;
  payee?: Member;
}

export interface ImportReportRow {
  row: number;
  description: string;
  issueFound: string;
  actionTaken: string;
}

export interface BalanceDetail {
  expenseId: string;
  description: string;
  date: string;
  amount: number;
  currency: string;
  originalAmount: number | null;
}

export interface NetBalance {
  userId: string;       // actually members.id
  userName: string;
  netAmount: number;
  details: BalanceDetail[];
}

export interface SimplifiedDebt {
  from: string;         // members.id
  fromName: string;
  to: string;           // members.id
  toName: string;
  amount: number;
  details: BalanceDetail[];
}
