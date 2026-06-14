/*
# Fix Supabase Security Audit Warnings

## Issues Fixed
1. Missing `SET search_path = public` in SECURITY DEFINER functions
   - Without this, a malicious user could manipulate search_path to execute
     arbitrary code in the context of the function owner
2. Unnecessary EXECUTE permissions granted to `anon` role
   - Unauthenticated users should not be able to call these helper functions
3. SECURITY DEFINER is REQUIRED (cannot convert to INVOKER)
   - These functions intentionally bypass RLS to break infinite recursion
   - Converting to SECURITY INVOKER would re-introduce the recursion problem

## Changes
1. Recreate `is_group_member()` with `SET search_path = public`
2. Recreate `is_group_creator()` with `SET search_path = public`
3. Revoke EXECUTE on both functions from `anon` role
4. Grant EXECUTE only to `authenticated` role
*/

-- ─── Fix is_group_member function ───
CREATE OR REPLACE FUNCTION is_group_member(p_group_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_memberships
    WHERE group_id = p_group_id
      AND user_id = p_user_id
      AND left_at IS NULL
  );
$$;

-- ─── Fix is_group_creator function ───
CREATE OR REPLACE FUNCTION is_group_creator(p_group_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM groups
    WHERE id = p_group_id
      AND created_by = p_user_id
  );
$$;

-- ─── Revoke EXECUTE from anon, grant only to authenticated ───
REVOKE EXECUTE ON FUNCTION is_group_member(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_group_member(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION is_group_member(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION is_group_creator(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_group_creator(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION is_group_creator(uuid, uuid) TO authenticated;

-- ─── Add function comments for documentation ───
COMMENT ON FUNCTION is_group_member(uuid, uuid) IS 
'SECURITY DEFINER helper function to check if a user is an active group member.
Used by RLS policies to avoid recursion. SET search_path = public prevents search_path injection.';

COMMENT ON FUNCTION is_group_creator(uuid, uuid) IS 
'SECURITY DEFINER helper function to check if a user created a group.
Used by RLS policies to avoid recursion. SET search_path = public prevents search_path injection.';