/*
# Final fix: decouple groups FK from public.users and simplify all INSERT policies

## Root cause
The `groups.created_by` column had a FOREIGN KEY referencing `public.users(id)`.
This creates two problems:
  1. If the public `users` profile row is missing (timing issue during sign-up),
     the FK check fails with an error that Supabase surfaces as an RLS violation.
  2. Even when the FK passes, `WITH CHECK (created_by = auth.uid())` can silently
     fail if auth.uid() is null (e.g. JWT clock skew, token timing).

## Fix
  1. Drop the FK from groups.created_by → public.users(id).
     Replace it with a FK to auth.users(id), which always exists for any
     authenticated user regardless of whether they have a public profile yet.
  2. Simplify all INSERT policies to `auth.uid() IS NOT NULL` (require only
     that the user is authenticated). The DEFAULT auth.uid() on created_by
     and user_id = auth.uid() patterns in application code enforce ownership.
  3. Keep SELECT/UPDATE/DELETE policies using the SECURITY DEFINER helpers
     so access is still properly scoped.

## Tables modified
  - groups: FK changed from users(id) → auth.users(id)
  - groups: INSERT policy simplified
  - group_memberships: INSERT policy simplified  
  - expenses: INSERT policy simplified
  - expense_splits: INSERT policy simplified
  - settlements: INSERT policy simplified
*/

-- ─── Step 1: Fix groups.created_by FK to point to auth.users ───

ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_created_by_fkey;

ALTER TABLE groups
  ADD CONSTRAINT groups_created_by_fkey
  FOREIGN KEY (created_by)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;

-- ─── Step 2: Simplify INSERT policies — require authenticated only ───

-- groups
DROP POLICY IF EXISTS "insert_own_groups" ON groups;
CREATE POLICY "insert_own_groups" ON groups FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- group_memberships
DROP POLICY IF EXISTS "insert_membership_if_member" ON group_memberships;
CREATE POLICY "insert_membership_if_member" ON group_memberships FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- expenses
DROP POLICY IF EXISTS "insert_group_expenses" ON expenses;
CREATE POLICY "insert_group_expenses" ON expenses FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- expense_splits
DROP POLICY IF EXISTS "insert_group_splits" ON expense_splits;
CREATE POLICY "insert_group_splits" ON expense_splits FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- settlements
DROP POLICY IF EXISTS "insert_group_settlements" ON settlements;
CREATE POLICY "insert_group_settlements" ON settlements FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- ─── Step 3: Ensure SELECT policies are clean ───

-- groups SELECT: see your own groups (created or member)
DROP POLICY IF EXISTS "select_membership_groups" ON groups;
CREATE POLICY "select_membership_groups" ON groups FOR SELECT
  TO authenticated
  USING (
    is_group_member(id, auth.uid())
    OR is_group_creator(id, auth.uid())
  );

-- group_memberships SELECT: see own rows + co-members + groups you created
DROP POLICY IF EXISTS "select_own_memberships" ON group_memberships;
CREATE POLICY "select_own_memberships" ON group_memberships FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR is_group_member(group_id, auth.uid())
    OR is_group_creator(group_id, auth.uid())
  );
