/*
# Add members table — support virtual (name-only) group participants

## Problem
expense_splits.user_id → users.id → auth.users.id
This chain means only people with Supabase auth accounts can participate
in expenses. Virtual flatmates (Aisha, Rohan, Priya, Meera, Dev, Sam)
cannot be added without creating accounts.

## Solution
Create a `members` table that tracks all group participants.
A member can optionally link to an auth user (user_id), but doesn't have to.
Re-point expense FKs from users(id) to members(id).

## Changes
1. CREATE members table
2. Migrate existing group_memberships into members (preserves the creator's record)
3. DROP old FK constraints on expenses, expense_splits, settlements
4. ADD new FK constraints pointing to members(id) instead of users(id)
5. Enable RLS on members with simple policies
6. Seed Aisha, Rohan, Priya, Meera (left Mar-2025), Dev, Sam into Team Mates
*/

-- ─── 1. Create members table ───

CREATE TABLE IF NOT EXISTS members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name       text NOT NULL,
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at  date NOT NULL DEFAULT CURRENT_DATE,
  left_at    date,
  UNIQUE (group_id, name)
);

CREATE INDEX IF NOT EXISTS idx_members_group   ON members(group_id);
CREATE INDEX IF NOT EXISTS idx_members_user    ON members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_name    ON members(group_id, name);

-- ─── 2. Migrate existing group_memberships → members ───
-- (picks up name from public.users where available)

INSERT INTO members (group_id, name, user_id, joined_at, left_at)
SELECT gm.group_id,
       COALESCE(u.name, 'Unknown'),
       gm.user_id,
       gm.joined_at,
       gm.left_at
FROM   group_memberships gm
LEFT   JOIN users u ON u.id = gm.user_id
ON     CONFLICT (group_id, name) DO NOTHING;

-- ─── 3. Drop old FK constraints that point to users(id) ───

ALTER TABLE expenses       DROP CONSTRAINT IF EXISTS expenses_paid_by_fkey;
ALTER TABLE expense_splits DROP CONSTRAINT IF EXISTS expense_splits_user_id_fkey;
ALTER TABLE settlements    DROP CONSTRAINT IF EXISTS settlements_paid_by_fkey;
ALTER TABLE settlements    DROP CONSTRAINT IF EXISTS settlements_paid_to_fkey;

-- ─── 4. Re-add FK constraints pointing to members(id) ───

ALTER TABLE expenses
  ADD CONSTRAINT expenses_paid_by_fkey
  FOREIGN KEY (paid_by) REFERENCES members(id) ON DELETE RESTRICT;

ALTER TABLE expense_splits
  ADD CONSTRAINT expense_splits_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES members(id) ON DELETE CASCADE;

ALTER TABLE settlements
  ADD CONSTRAINT settlements_paid_by_fkey
  FOREIGN KEY (paid_by) REFERENCES members(id) ON DELETE RESTRICT;

ALTER TABLE settlements
  ADD CONSTRAINT settlements_paid_to_fkey
  FOREIGN KEY (paid_to) REFERENCES members(id) ON DELETE RESTRICT;

-- ─── 5. RLS on members ───

ALTER TABLE members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_members" ON members FOR SELECT
  TO authenticated
  USING (
    is_group_member(group_id, auth.uid())
    OR is_group_creator(group_id, auth.uid())
  );

CREATE POLICY "insert_members" ON members FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "update_members" ON members FOR UPDATE
  TO authenticated
  USING (
    is_group_member(group_id, auth.uid())
    OR is_group_creator(group_id, auth.uid())
  );

CREATE POLICY "delete_members" ON members FOR DELETE
  TO authenticated
  USING (
    is_group_member(group_id, auth.uid())
    OR is_group_creator(group_id, auth.uid())
  );

-- ─── 6. Seed the 6 flatmates into the Team Mates group ───
-- Context: Meera left end of March 2025. Sam joined mid-April 2025.
-- Dev joined for a trip (March 2025). Others from Jan 2025.
-- Only inserts if Team Mates group exists; safe to run on fresh DB too.

INSERT INTO members (group_id, name, user_id, joined_at, left_at)
SELECT
  g.id,
  v.name,
  NULL::uuid,
  v.joined_at::date,
  v.left_at::date
FROM groups g
CROSS JOIN (VALUES
  ('Aisha',  '2025-01-01', NULL),
  ('Rohan',  '2025-01-01', NULL),
  ('Priya',  '2025-01-01', NULL),
  ('Meera',  '2025-01-01', '2025-03-31'),
  ('Dev',    '2025-03-01', NULL),
  ('Sam',    '2025-04-15', NULL)
) AS v(name, joined_at, left_at)
WHERE g.name = 'Team Mates'
ON CONFLICT (group_id, name) DO UPDATE
  SET joined_at = EXCLUDED.joined_at,
      left_at   = EXCLUDED.left_at;
