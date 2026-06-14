/*
# Simplify users SELECT policy - allow all authenticated users to view profiles

## Problem
The previous policy (select_visible_users) only allowed viewing co-members,
but the Add Member search needs to find users NOT yet in any shared group.

## Solution
For a shared expenses app, all authenticated users need to be discoverable
so they can be added to groups. Change the SELECT policy to allow all
authenticated users to read the users table.

This is safe because:
- The users table only contains id, name, email, and timestamps
- No sensitive data (password_hash is stored in auth.users, not here)
- Users need to find each other to form expense groups

## Changes
- Drop `select_visible_users` policy
- Create `select_all_authenticated_users` allowing all authenticated reads
*/

DROP POLICY IF EXISTS "select_visible_users" ON users;
CREATE POLICY "select_all_authenticated_users" ON users FOR SELECT
  TO authenticated USING (true);
