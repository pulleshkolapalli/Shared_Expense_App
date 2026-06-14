/*
# Fix users table RLS - allow viewing co-members

## Problem
The `users` table SELECT policy only allows users to see their own row:
  `auth.uid() = id`

This breaks:
1. Group member lists - can't fetch names of other members
2. Add Member search - can't search for other users
3. Expense display - can't show who paid
4. Settlement display - can't show payer/payee names

## Solution
Update the SELECT policy to allow authenticated users to view:
1. Their own profile (existing)
2. Profiles of users they share a group with (via is_group_member helper)

This uses the SECURITY DEFINER is_group_member function to avoid recursion.

## Changes
- Drop `select_own_users` policy
- Create `select_visible_users` policy allowing:
  - Own profile: auth.uid() = id
  - Co-members: EXISTS check via is_group_member on shared groups
*/

DROP POLICY IF EXISTS "select_own_users" ON users;
CREATE POLICY "select_visible_users" ON users FOR SELECT
  TO authenticated USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM group_memberships gm1
      WHERE gm1.user_id = auth.uid()
        AND gm1.left_at IS NULL
        AND EXISTS (
          SELECT 1 FROM group_memberships gm2
          WHERE gm2.group_id = gm1.group_id
            AND gm2.user_id = users.id
            AND gm2.left_at IS NULL
        )
    )
  );
