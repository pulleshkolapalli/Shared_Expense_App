/*
# Fix Groups Table RLS Policies

## Problem
The INSERT policy on groups was too permissive: `WITH CHECK (auth.uid() IS NOT NULL)`
This allows any authenticated user to create a group with any created_by value.

## Solution
Create explicit policies that enforce:
- INSERT: created_by must equal auth.uid() (user can only create groups as themselves)
- SELECT: User can view groups they created OR are a member of
- UPDATE: Only the creator can update their groups  
- DELETE: Only the creator can delete their groups

## Security Notes
- Uses is_group_member() and is_group_creator() helper functions (SECURITY DEFINER with fixed search_path)
- These functions safely bypass RLS to check membership without recursion
- All policies use auth.uid() safely - no SQL injection risk
*/

-- ─── Drop and recreate INSERT policy ───
DROP POLICY IF EXISTS "insert_own_groups" ON groups;
CREATE POLICY "insert_own_groups" ON groups FOR INSERT
  TO authenticated WITH CHECK (created_by = auth.uid());

-- ─── Drop and recreate SELECT policy ───
-- Users can see groups they're a member of OR groups they created
DROP POLICY IF EXISTS "select_membership_groups" ON groups;
CREATE POLICY "select_membership_groups" ON groups FOR SELECT
  TO authenticated USING (
    is_group_member(id, auth.uid()) OR is_group_creator(id, auth.uid())
  );

-- ─── Drop and recreate UPDATE policy ───
-- Only the creator can update the group
DROP POLICY IF EXISTS "update_own_groups" ON groups;
CREATE POLICY "update_own_groups" ON groups FOR UPDATE
  TO authenticated USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- ─── Drop and recreate DELETE policy ───
-- Only the creator can delete the group
DROP POLICY IF EXISTS "delete_own_groups" ON groups;
CREATE POLICY "delete_own_groups" ON groups FOR DELETE
  TO authenticated USING (created_by = auth.uid());

-- ─── Verify RLS is enabled ───
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- ─── Add policy documentation ───
COMMENT ON POLICY "insert_own_groups" ON groups IS 
'Allows authenticated users to create groups only where created_by matches their auth.uid()';

COMMENT ON POLICY "select_membership_groups" ON groups IS 
'Allows users to view groups they are a member of OR created';

COMMENT ON POLICY "update_own_groups" ON groups IS 
'Allows only the group creator to update the group';

COMMENT ON POLICY "delete_own_groups" ON groups IS 
'Allows only the group creator to delete the group';