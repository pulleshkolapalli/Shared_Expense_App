/*
# Shared Expenses App - Enable RLS and Add Policies

1. Security
   - RLS enabled on all 6 tables.
   - Users: owner-scoped (auth.uid() = id)
   - Groups: visible to members, insertable by creator
   - Group_memberships: visible to co-members, insertable by co-members
   - Expenses: visible to group members only
   - Expense_splits: visible to group members via expense→group membership
   - Settlements: visible to group members only
*/

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

-- Users policies
DROP POLICY IF EXISTS "select_own_users" ON users;
CREATE POLICY "select_own_users" ON users FOR SELECT
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "insert_own_users" ON users;
CREATE POLICY "insert_own_users" ON users FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_users" ON users;
CREATE POLICY "update_own_users" ON users FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Groups policies
DROP POLICY IF EXISTS "select_membership_groups" ON groups;
CREATE POLICY "select_membership_groups" ON groups FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM group_memberships WHERE group_memberships.group_id = groups.id AND group_memberships.user_id = auth.uid())
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS "insert_own_groups" ON groups;
CREATE POLICY "insert_own_groups" ON groups FOR INSERT
  TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "update_own_groups" ON groups;
CREATE POLICY "update_own_groups" ON groups FOR UPDATE
  TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "delete_own_groups" ON groups;
CREATE POLICY "delete_own_groups" ON groups FOR DELETE
  TO authenticated USING (created_by = auth.uid());

-- Group memberships policies
DROP POLICY IF EXISTS "select_own_memberships" ON group_memberships;
CREATE POLICY "select_own_memberships" ON group_memberships FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM group_memberships gm2 WHERE gm2.group_id = group_memberships.group_id AND gm2.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_membership_if_member" ON group_memberships;
CREATE POLICY "insert_membership_if_member" ON group_memberships FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM group_memberships gm2 WHERE gm2.group_id = group_memberships.group_id AND gm2.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM groups WHERE groups.id = group_memberships.group_id AND groups.created_by = auth.uid())
  );

DROP POLICY IF EXISTS "update_membership_if_member" ON group_memberships;
CREATE POLICY "update_membership_if_member" ON group_memberships FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM group_memberships gm2 WHERE gm2.group_id = group_memberships.group_id AND gm2.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_membership_if_member" ON group_memberships;
CREATE POLICY "delete_membership_if_member" ON group_memberships FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM group_memberships gm2 WHERE gm2.group_id = group_memberships.group_id AND gm2.user_id = auth.uid())
  );

-- Expenses policies
DROP POLICY IF EXISTS "select_group_expenses" ON expenses;
CREATE POLICY "select_group_expenses" ON expenses FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM group_memberships WHERE group_memberships.group_id = expenses.group_id AND group_memberships.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_group_expenses" ON expenses;
CREATE POLICY "insert_group_expenses" ON expenses FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM group_memberships WHERE group_memberships.group_id = expenses.group_id AND group_memberships.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_group_expenses" ON expenses;
CREATE POLICY "update_group_expenses" ON expenses FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM group_memberships WHERE group_memberships.group_id = expenses.group_id AND group_memberships.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM group_memberships WHERE group_memberships.group_id = expenses.group_id AND group_memberships.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_group_expenses" ON expenses;
CREATE POLICY "delete_group_expenses" ON expenses FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM group_memberships WHERE group_memberships.group_id = expenses.group_id AND group_memberships.user_id = auth.uid())
  );

-- Expense splits policies
DROP POLICY IF EXISTS "select_group_splits" ON expense_splits;
CREATE POLICY "select_group_splits" ON expense_splits FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM expenses e
      JOIN group_memberships gm ON gm.group_id = e.group_id
      WHERE e.id = expense_splits.expense_id AND gm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_group_splits" ON expense_splits;
CREATE POLICY "insert_group_splits" ON expense_splits FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM expenses e
      JOIN group_memberships gm ON gm.group_id = e.group_id
      WHERE e.id = expense_splits.expense_id AND gm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "update_group_splits" ON expense_splits;
CREATE POLICY "update_group_splits" ON expense_splits FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM expenses e
      JOIN group_memberships gm ON gm.group_id = e.group_id
      WHERE e.id = expense_splits.expense_id AND gm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "delete_group_splits" ON expense_splits;
CREATE POLICY "delete_group_splits" ON expense_splits FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM expenses e
      JOIN group_memberships gm ON gm.group_id = e.group_id
      WHERE e.id = expense_splits.expense_id AND gm.user_id = auth.uid()
    )
  );

-- Settlements policies
DROP POLICY IF EXISTS "select_group_settlements" ON settlements;
CREATE POLICY "select_group_settlements" ON settlements FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM group_memberships WHERE group_memberships.group_id = settlements.group_id AND group_memberships.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_group_settlements" ON settlements;
CREATE POLICY "insert_group_settlements" ON settlements FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM group_memberships WHERE group_memberships.group_id = settlements.group_id AND group_memberships.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_group_settlements" ON settlements;
CREATE POLICY "update_group_settlements" ON settlements FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM group_memberships WHERE group_memberships.group_id = settlements.group_id AND group_memberships.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_group_settlements" ON settlements;
CREATE POLICY "delete_group_settlements" ON settlements FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM group_memberships WHERE group_memberships.group_id = settlements.group_id AND group_memberships.user_id = auth.uid())
  );
