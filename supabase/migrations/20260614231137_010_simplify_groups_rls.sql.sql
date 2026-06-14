/*
# Fix Groups RLS Policies - Simplified

## Problem
Group creation failing with RLS policy violation despite policies appearing correct.
The INSERT policy `created_by = auth.uid()` should work, but there may be
interactions with the SELECT policy's helper functions.

## Solution
Simplify ALL policies to use only direct `created_by = auth.uid()` checks.
This eliminates any potential issues with helper functions and ensures
a newly registered user can:
- INSERT a group (created_by matches their auth.uid())
- SELECT groups they created
- UPDATE groups they created
- DELETE groups they created

## Note
This simplified approach doesn't support group membership viewing.
For full membership support, users should use group_memberships table.
*/

-- Drop all existing policies
DROP POLICY IF EXISTS "select_membership_groups" ON groups;
DROP POLICY IF EXISTS "insert_own_groups" ON groups;
DROP POLICY IF EXISTS "update_own_groups" ON groups;
DROP POLICY IF EXISTS "delete_own_groups" ON groups;

-- ─── Create simple, direct policies ───

-- SELECT: Users can view groups they created
CREATE POLICY "select_own_groups" ON groups FOR SELECT
  TO authenticated USING (created_by = auth.uid());

-- INSERT: Users can create groups where created_by matches their auth.uid()
CREATE POLICY "insert_own_groups" ON groups FOR INSERT
  TO authenticated WITH CHECK (created_by = auth.uid());

-- UPDATE: Users can update groups they created
CREATE POLICY "update_own_groups" ON groups FOR UPDATE
  TO authenticated USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- DELETE: Users can delete groups they created
CREATE POLICY "delete_own_groups" ON groups FOR DELETE
  TO authenticated USING (created_by = auth.uid());

-- Ensure RLS is enabled
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- Add documentation
COMMENT ON POLICY "select_own_groups" ON groups IS 
'Users can view groups where they are the creator (created_by = auth.uid())';

COMMENT ON POLICY "insert_own_groups" ON groups IS 
'Users can create groups with created_by matching their auth.uid()';

COMMENT ON POLICY "update_own_groups" ON groups IS 
'Users can update groups they created';

COMMENT ON POLICY "delete_own_groups" ON groups IS 
'Users can delete groups they created';