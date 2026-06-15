/*
# Fix SECURITY DEFINER Function Security Warnings

## Problem
The `is_group_creator` and `is_group_member` functions can be called directly 
via REST API (`/rest/v1/rpc/...`) by authenticated users, allowing them to 
enumerate group memberships for any user.

## Solution
Add a check that `p_user_id = auth.uid()` inside the functions. This:
- Prevents REST API abuse (users can only check their own membership)
- Keeps SECURITY DEFINER (required to break RLS recursion)
- Keeps RLS policies working (policies pass auth.uid() as p_user_id)

## Why SECURITY DEFINER is required
These functions are called from RLS policies. If they were SECURITY INVOKER,
they would run under the caller's RLS context, causing infinite recursion:
- User queries `expenses` → RLS checks `is_group_member(expenses.group_id, auth.uid())`
- `is_group_member` queries `group_memberships` → Under SECURITY INVOKER, 
  RLS on `group_memberships` would also apply, potentially calling back

SECURITY DEFINER bypasses the caller's RLS, avoiding recursion.

## Security Hardening Applied
1. Functions check `p_user_id = auth.uid()` - prevents enumeration
2. `SET search_path = public` - prevents search_path injection  
3. `EXECUTE` revoked from PUBLIC - only authenticated can call
4. Functions only return boolean - minimal data exposure
*/

-- ─── Replace is_group_creator with secure version ───
CREATE OR REPLACE FUNCTION public.is_group_creator(p_group_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
SELECT EXISTS (
  SELECT 1 FROM groups
  WHERE id = p_group_id
  AND created_by = p_user_id
  AND p_user_id = auth.uid()  -- Security: only check own membership
);
$function$;

-- ─── Replace is_group_member with secure version ───
CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
SELECT EXISTS (
  SELECT 1 FROM group_memberships
  WHERE group_id = p_group_id
  AND user_id = p_user_id
  AND left_at IS NULL
  AND p_user_id = auth.uid()  -- Security: only check own membership
);
$function$;

-- ─── Revoke EXECUTE from PUBLIC (includes anon) ───
REVOKE EXECUTE ON FUNCTION public.is_group_creator(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_group_member(uuid, uuid) FROM PUBLIC;

-- ─── Grant EXECUTE to authenticated role only ───
GRANT EXECUTE ON FUNCTION public.is_group_creator(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_member(uuid, uuid) TO authenticated;

-- ─── Add documentation ───
COMMENT ON FUNCTION public.is_group_creator(uuid, uuid) IS 
'Checks if the current authenticated user is the creator of a group. 
Security: p_user_id must match auth.uid() to prevent enumeration attacks.';

COMMENT ON FUNCTION public.is_group_member(uuid, uuid) IS 
'Checks if the current authenticated user is an active member of a group.
Security: p_user_id must match auth.uid() to prevent enumeration attacks.';