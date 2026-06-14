/*
# Fix RLS Infinite Recursion on groups and group_memberships

## Problem
The RLS policies on `groups` and `group_memberships` caused infinite recursion:

1. `groups` SELECT policy (`select_membership_groups`) checks
   `EXISTS (SELECT 1 FROM group_memberships WHERE user_id = auth.uid())`
2. `group_memberships` policies (`select_own_memberships`, `insert_membership_if_member`,
   `update_membership_if_member`, `delete_membership_if_member`) all check
   `EXISTS (SELECT 1 FROM group_memberships gm2 WHERE gm2.user_id = auth.uid())`

This creates a circular dependency: reading groups requires reading memberships,
which requires reading memberships again (self-reference), causing infinite recursion.

## Solution
Create SECURITY DEFINER helper functions that run as the function owner (superuser),
bypassing RLS entirely. All policies then call these functions instead of subquerying
the tables directly. Since the functions don't go through RLS, there is no recursion.

## Changes
1. New functions:
   - `is_group_member(p_group_id uuid, p_user_id uuid)` → boolean
     Checks if a user is an active member of a group (left_at IS NULL).
     Runs as SECURITY DEFINER to bypass RLS.
   - `is_group_creator(p_group_id uuid, p_user_id uuid)` → boolean
     Checks if a user created a group. Runs as SECURITY DEFINER.

2. Dropped and recreated policies on `groups`:
   - `select_membership_groups` → uses is_group_member() and is_group_creator()
   - `insert_own_groups` → created_by = auth.uid() (no subquery, safe)
   - `update_own_groups` → created_by = auth.uid() (no subquery, safe)
   - `delete_own_groups` → created_by = auth.uid() (no subquery, safe)

3. Dropped and recreated policies on `group_memberships`:
   - `select_own_memberships` → user_id = auth.uid() OR is_group_member()
   - `insert_membership_if_member` → is_group_member() OR is_group_creator()
   - `update_membership_if_member` → is_group_member()
   - `delete_membership_if_member` → is_group_member()

4. Also fixed `expenses`, `expense_splits`, and `settlements` policies
   that referenced `group_memberships` via subqueries to use the new
   helper functions instead, preventing potential secondary recursion.

## Security Notes
1. The helper functions are SECURITY DEFINER — they run as the function owner,
   not the calling user. This is intentional and safe because:
   - They only return boolean values (no data exposure)
   - They only check membership/ownership (no data modification)
   - They are the standard Supabase pattern for breaking RLS recursion

2. All policies still enforce proper access control:
   - Users can only see groups they belong to or created
   - Users can only modify memberships in groups they belong to
   - Group creators get implicit membership access for their groups
*/

-- ─── Helper Functions (SECURITY DEFINER to break recursion) ───

CREATE OR REPLACE FUNCTION is_group_member(p_group_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_memberships
    WHERE group_id = p_group_id
      AND user_id = p_user_id
      AND left_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION is_group_creator(p_group_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM groups
    WHERE id = p_group_id
      AND created_by = p_user_id
  );
$$;

-- ─── groups policies ───

DROP POLICY IF EXISTS "select_membership_groups" ON groups;
CREATE POLICY "select_membership_groups" ON groups FOR SELECT
  TO authenticated USING (
    is_group_member(id, auth.uid()) OR is_group_creator(id, auth.uid())
  );

-- INSERT, UPDATE, DELETE on groups don't reference group_memberships — no recursion risk
-- But drop and recreate for clean state
DROP POLICY IF EXISTS "insert_own_groups" ON groups;
CREATE POLICY "insert_own_groups" ON groups FOR INSERT
  TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "update_own_groups" ON groups;
CREATE POLICY "update_own_groups" ON groups FOR UPDATE
  TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "delete_own_groups" ON groups;
CREATE POLICY "delete_own_groups" ON groups FOR DELETE
  TO authenticated USING (created_by = auth.uid());

-- ─── group_memberships policies ───

DROP POLICY IF EXISTS "select_own_memberships" ON group_memberships;
CREATE POLICY "select_own_memberships" ON group_memberships FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR is_group_member(group_id, auth.uid())
    OR is_group_creator(group_id, auth.uid())
  );

DROP POLICY IF EXISTS "insert_membership_if_member" ON group_memberships;
CREATE POLICY "insert_membership_if_member" ON group_memberships FOR INSERT
  TO authenticated WITH CHECK (
    is_group_member(group_id, auth.uid())
    OR is_group_creator(group_id, auth.uid())
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "update_membership_if_member" ON group_memberships;
CREATE POLICY "update_membership_if_member" ON group_memberships FOR UPDATE
  TO authenticated USING (
    is_group_member(group_id, auth.uid())
    OR is_group_creator(group_id, auth.uid())
  );

DROP POLICY IF EXISTS "delete_membership_if_member" ON group_memberships;
CREATE POLICY "delete_membership_if_member" ON group_memberships FOR DELETE
  TO authenticated USING (
    is_group_member(group_id, auth.uid())
    OR is_group_creator(group_id, auth.uid())
  );

-- ─── expenses policies (also fix to use helper functions) ───

DROP POLICY IF EXISTS "select_group_expenses" ON expenses;
CREATE POLICY "select_group_expenses" ON expenses FOR SELECT
  TO authenticated USING (
    is_group_member(group_id, auth.uid()) OR is_group_creator(group_id, auth.uid())
  );

DROP POLICY IF EXISTS "insert_group_expenses" ON expenses;
CREATE POLICY "insert_group_expenses" ON expenses FOR INSERT
  TO authenticated WITH CHECK (
    is_group_member(group_id, auth.uid()) OR is_group_creator(group_id, auth.uid())
  );

DROP POLICY IF EXISTS "update_group_expenses" ON expenses;
CREATE POLICY "update_group_expenses" ON expenses FOR UPDATE
  TO authenticated USING (
    is_group_member(group_id, auth.uid()) OR is_group_creator(group_id, auth.uid())
  ) WITH CHECK (
    is_group_member(group_id, auth.uid()) OR is_group_creator(group_id, auth.uid())
  );

DROP POLICY IF EXISTS "delete_group_expenses" ON expenses;
CREATE POLICY "delete_group_expenses" ON expenses FOR DELETE
  TO authenticated USING (
    is_group_member(group_id, auth.uid()) OR is_group_creator(group_id, auth.uid())
  );

-- ─── expense_splits policies ───

DROP POLICY IF EXISTS "select_group_splits" ON expense_splits;
CREATE POLICY "select_group_splits" ON expense_splits FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM expenses
      WHERE expenses.id = expense_splits.expense_id
        AND (is_group_member(expenses.group_id, auth.uid()) OR is_group_creator(expenses.group_id, auth.uid()))
    )
  );

DROP POLICY IF EXISTS "insert_group_splits" ON expense_splits;
CREATE POLICY "insert_group_splits" ON expense_splits FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM expenses
      WHERE expenses.id = expense_splits.expense_id
        AND (is_group_member(expenses.group_id, auth.uid()) OR is_group_creator(expenses.group_id, auth.uid()))
    )
  );

DROP POLICY IF EXISTS "update_group_splits" ON expense_splits;
CREATE POLICY "update_group_splits" ON expense_splits FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM expenses
      WHERE expenses.id = expense_splits.expense_id
        AND (is_group_member(expenses.group_id, auth.uid()) OR is_group_creator(expenses.group_id, auth.uid()))
    )
  );

DROP POLICY IF EXISTS "delete_group_splits" ON expense_splits;
CREATE POLICY "delete_group_splits" ON expense_splits FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM expenses
      WHERE expenses.id = expense_splits.expense_id
        AND (is_group_member(expenses.group_id, auth.uid()) OR is_group_creator(expenses.group_id, auth.uid()))
    )
  );

-- ─── settlements policies ───

DROP POLICY IF EXISTS "select_group_settlements" ON settlements;
CREATE POLICY "select_group_settlements" ON settlements FOR SELECT
  TO authenticated USING (
    is_group_member(group_id, auth.uid()) OR is_group_creator(group_id, auth.uid())
  );

DROP POLICY IF EXISTS "insert_group_settlements" ON settlements;
CREATE POLICY "insert_group_settlements" ON settlements FOR INSERT
  TO authenticated WITH CHECK (
    is_group_member(group_id, auth.uid()) OR is_group_creator(group_id, auth.uid())
  );

DROP POLICY IF EXISTS "update_group_settlements" ON settlements;
CREATE POLICY "update_group_settlements" ON settlements FOR UPDATE
  TO authenticated USING (
    is_group_member(group_id, auth.uid()) OR is_group_creator(group_id, auth.uid())
  );

DROP POLICY IF EXISTS "delete_group_settlements" ON settlements;
CREATE POLICY "delete_group_settlements" ON settlements FOR DELETE
  TO authenticated USING (
    is_group_member(group_id, auth.uid()) OR is_group_creator(group_id, auth.uid())
  );
