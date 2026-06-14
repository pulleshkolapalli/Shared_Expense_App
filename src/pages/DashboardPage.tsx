import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/Toasts';
import type { Group } from '../types';
import { Plus, Users, LogOut, ArrowRight } from 'lucide-react';

export default function DashboardPage({ onSelectGroup }: { onSelectGroup: (groupId: string) => void }) {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [groups, setGroups] = useState<(Group & { member_count: number })[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadGroups();
  }, []);

  async function loadGroups() {
    setLoading(true);
    const userId = user?.id;
    if (!userId) { setLoading(false); return; }

    // Get groups where user is an active member
    const { data: memberships, error: mErr } = await supabase
      .from('group_memberships')
      .select('group_id, groups(id, name, created_by, created_at)')
      .eq('user_id', userId)
      .is('left_at', null);

    if (mErr) {
      toast('error', `Failed to load groups: ${mErr.message}`);
      setLoading(false);
      return;
    }

    if (memberships && memberships.length > 0) {
      const groupIds = new Set<string>();
      const groupMap = new Map<string, Group & { member_count: number }>();
      for (const m of memberships) {
        const g = m.groups as unknown as Group;
        if (g && !groupIds.has(g.id)) {
          groupIds.add(g.id);
          groupMap.set(g.id, { ...g, member_count: 1 });
        } else if (g) {
          const existing = groupMap.get(g.id);
          if (existing) groupMap.set(g.id, { ...existing, member_count: existing.member_count + 1 });
        }
      }

      // Count active participants from members table (includes virtual members)
      const { data: allMembers } = await supabase
        .from('members')
        .select('group_id')
        .in('group_id', Array.from(groupIds))
        .is('left_at', null);

      if (allMembers) {
        const countMap = new Map<string, number>();
        for (const am of allMembers) {
          countMap.set(am.group_id, (countMap.get(am.group_id) || 0) + 1);
        }
        for (const [id, g] of groupMap) {
          g.member_count = countMap.get(id) || 1;
        }
      }

      setGroups(Array.from(groupMap.values()));
    } else {
      setGroups([]);
    }
    setLoading(false);
  }

  async function createGroup() {
    if (!newGroupName.trim()) return;
    setCreating(true);

    try {
      const { data: group, error: groupError } = await supabase
        .from('groups')
        .insert({ name: newGroupName.trim(), created_by: user!.id })
        .select('id')
        .single();

      if (groupError) {
        // Detailed error logging for debugging RLS policy issues
        console.error('Group creation failed:', {
          message: groupError.message,
          code: groupError.code,
          details: groupError.details,
          hint: groupError.hint,
          userId: user?.id,
          insertedCreatedBy: user!.id,
        });
        toast('error', `Failed to create group: ${groupError.message}${groupError.hint ? ` (${groupError.hint})` : ''}`);
        setCreating(false);
        return;
      }

      if (group) {
        const today = new Date().toISOString().split('T')[0];

        // Auth membership (drives RLS access to the group)
        const { error: memberError } = await supabase.from('group_memberships').insert({
          group_id: group.id,
          user_id: user!.id,
          joined_at: today,
        });

        // Expense-tracking member row for the creator
        await supabase.from('members').insert({
          group_id: group.id,
          name: user!.name,
          user_id: user!.id,
          joined_at: today,
        });

        if (memberError) {
          toast('error', `Group created but membership failed: ${memberError.message}`);
        } else {
          toast('success', `Group "${newGroupName.trim()}" created!`);
        }
        setNewGroupName('');
        setShowCreate(false);
        await loadGroups();
      }
    } catch (err) {
      toast('error', 'Unexpected error creating group');
    }
    setCreating(false);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-teal-600 text-white flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">SplitEase</h1>
              <p className="text-xs text-slate-500">Welcome, {user?.name}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
            title="Sign out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-slate-900">Your Groups</h2>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-semibold text-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> New Group
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-slate-400">Loading groups...</div>
        ) : groups.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Users className="w-10 h-10 text-slate-300" />
            </div>
            <h3 className="text-lg font-semibold text-slate-700">No groups yet</h3>
            <p className="text-slate-400 mt-1">Create your first group to start tracking expenses</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {groups.map(g => (
              <button
                key={g.id}
                onClick={() => onSelectGroup(g.id)}
                className="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md border border-slate-100 text-left transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-lg text-slate-900">{g.name}</h3>
                    <p className="text-sm text-slate-400 mt-1">{g.member_count} member{g.member_count !== 1 ? 's' : ''}</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-teal-500 transition-colors" />
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) { setShowCreate(false); setNewGroupName(''); } }}>
          <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl">
            <h3 className="text-xl font-bold text-slate-900 mb-4">Create New Group</h3>
            <input
              type="text"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none text-slate-900 mb-4"
              placeholder="Group name (e.g., Flat 302)"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && !creating && createGroup()}
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setShowCreate(false); setNewGroupName(''); }}
                className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createGroup}
                disabled={creating}
                className="flex-1 py-3 rounded-xl bg-teal-600 text-white font-semibold hover:bg-teal-700 transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
