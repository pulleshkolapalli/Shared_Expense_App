import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/Toasts';
import type { Group, Member, Expense, ExpenseSplit, Settlement, ImportReportRow, NetBalance, SimplifiedDebt } from '../types';
import { calculateNetBalances, simplifyDebts } from '../lib/balances';
import { parseCSV } from '../lib/csvParser';
import {
  ArrowLeft, ArrowRight, Users, Receipt, Upload, Scale, ChevronDown, ChevronUp,
  Plus, UserPlus, LogOut, FileDown, X, Check, AlertTriangle, CalendarDays
} from 'lucide-react';

type Tab = 'expenses' | 'balances' | 'members' | 'import';

export default function GroupPage({ groupId, onBack }: { groupId: string; onBack: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [expenses, setExpenses] = useState<(Expense & { member: Member; expense_splits: (ExpenseSplit & { member: Member })[] })[]>([]);
  const [settlements, setSettlements] = useState<(Settlement & { payer: Member; payee: Member })[]>([]);
  const [tab, setTab] = useState<Tab>('expenses');
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<NetBalance[]>([]);
  const [debts, setDebts] = useState<SimplifiedDebt[]>([]);
  const [expandedBalance, setExpandedBalance] = useState<string | null>(null);
  const [expandedDebt, setExpandedDebt] = useState<number | null>(null);

  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showSettle, setShowSettle] = useState(false);
  const [importReport, setImportReport] = useState<ImportReportRow[] | null>(null);
  const [importStats, setImportStats] = useState<{ imported: number; skipped: number } | null>(null);

  const loadGroup = useCallback(async () => {
    setLoading(true);
    try {
      const { data: g } = await supabase.from('groups').select('*').eq('id', groupId).maybeSingle();
      if (g) setGroup(g);

      const { data: m, error: mErr } = await supabase
        .from('members')
        .select('*')
        .eq('group_id', groupId)
        .order('joined_at');
      if (mErr) toast('error', `Failed to load members: ${mErr.message}`);
      if (m) setMembers(m as Member[]);

      const { data: e, error: eErr } = await supabase
        .from('expenses')
        .select('*, member:paid_by(*), expense_splits(*, member:user_id(*))')
        .eq('group_id', groupId)
        .order('date', { ascending: false });
      if (eErr) toast('error', `Failed to load expenses: ${eErr.message}`);
      if (e) setExpenses(e as (Expense & { member: Member; expense_splits: (ExpenseSplit & { member: Member })[] })[]);

      const { data: s, error: sErr } = await supabase
        .from('settlements')
        .select('*, payer:paid_by(*), payee:paid_to(*)')
        .eq('group_id', groupId)
        .order('date', { ascending: false });
      if (sErr) toast('error', `Failed to load settlements: ${sErr.message}`);
      if (s) setSettlements(s as (Settlement & { payer: Member; payee: Member })[]);
    } catch {
      toast('error', 'Unexpected error loading group data');
    }
    setLoading(false);
  }, [groupId, toast]);

  useEffect(() => { loadGroup(); }, [loadGroup]);

  useEffect(() => {
    const active = members.filter(m => !m.left_at);
    if ((expenses.length > 0 || settlements.length > 0) && active.length > 0) {
      setBalances(calculateNetBalances(expenses, settlements, active));
      setDebts(simplifyDebts(calculateNetBalances(expenses, settlements, active)));
    } else {
      setBalances([]);
      setDebts([]);
    }
  }, [expenses, settlements, members]);

  function formatINR(amount: number) {
    const abs = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';
    if (abs >= 10000000) return `${sign}\u20B9${(abs / 10000000).toFixed(2)}Cr`;
    if (abs >= 100000)  return `${sign}\u20B9${(abs / 100000).toFixed(2)}L`;
    return `${sign}\u20B9${abs.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'expenses', label: 'Expenses',   icon: <Receipt className="w-4 h-4" /> },
    { key: 'balances', label: 'Balances',   icon: <Scale   className="w-4 h-4" /> },
    { key: 'members',  label: 'Members',    icon: <Users   className="w-4 h-4" /> },
    { key: 'import',   label: 'Import CSV', icon: <Upload  className="w-4 h-4" /> },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50 flex items-center justify-center">
        <div className="text-slate-400">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex-1">
              <h1 className="text-lg font-bold text-slate-900">{group?.name}</h1>
              <p className="text-xs text-slate-500">{members.filter(m => !m.left_at).length} active members</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowSettle(true)} className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors">
                Settle
              </button>
              <button onClick={() => setShowAddExpense(true)} className="px-3 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 transition-colors flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Expense
              </button>
            </div>
          </div>
          <div className="flex gap-1 mt-4 bg-slate-100 rounded-xl p-1">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all ${
                  tab === t.key ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.icon} <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {tab === 'expenses' && <ExpensesTab />}
        {tab === 'balances' && <BalancesTab />}
        {tab === 'members'  && <MembersTab />}
        {tab === 'import'   && <ImportTab />}
      </main>

      {showAddExpense && <AddExpenseModal />}
      {showAddMember  && <AddMemberModal />}
      {showSettle     && <SettleModal />}
      {importReport   && <ImportReportModal />}
    </div>
  );

  // ─── Expenses Tab ───
  function ExpensesTab() {
    return (
      <div className="space-y-3">
        {expenses.length === 0 && settlements.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Receipt className="w-10 h-10 text-slate-300" />
            </div>
            <h3 className="text-lg font-semibold text-slate-700">No expenses yet</h3>
            <p className="text-slate-400 mt-1">Add an expense or import a CSV</p>
          </div>
        ) : (
          <>
            {expenses.map(exp => (
              <div key={exp.id} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-900 truncate">{exp.description}</h3>
                    <p className="text-sm text-slate-400 mt-0.5">
                      Paid by <span className="text-slate-600 font-medium">{exp.member?.name ?? '—'}</span> on {exp.date}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className="inline-flex items-center px-2 py-1 rounded-md bg-teal-50 text-teal-700 text-xs font-medium">
                        {exp.split_type}
                      </span>
                      {exp.currency === 'USD' && (
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-amber-50 text-amber-700 text-xs font-medium">
                          USD @ {exp.exchange_rate}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold text-slate-900">{formatINR(exp.amount_inr)}</p>
                    {exp.currency === 'USD' && exp.original_amount && (
                      <p className="text-xs text-slate-400">${exp.original_amount}</p>
                    )}
                  </div>
                </div>
                {exp.expense_splits.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="text-xs text-slate-400 mb-1.5">Split</p>
                    <div className="flex flex-wrap gap-2">
                      {exp.expense_splits.map(s => (
                        <span key={s.id} className="inline-flex items-center px-2 py-1 rounded-md bg-slate-50 text-slate-600 text-xs">
                          {s.member?.name ?? '—'}: {formatINR(s.amount_owed)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {settlements.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Settlements</h3>
                {settlements.map(s => (
                  <div key={s.id} className="bg-emerald-50 rounded-xl p-4 mb-2 border border-emerald-100">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-emerald-800">{s.payer?.name}</span>
                        <span className="text-emerald-600 mx-2">paid</span>
                        <span className="font-medium text-emerald-800">{s.payee?.name}</span>
                      </div>
                      <span className="font-bold text-emerald-700">{formatINR(s.amount)}</span>
                    </div>
                    <p className="text-xs text-emerald-500 mt-1">{s.date}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ─── Balances Tab ───
  function BalancesTab() {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Net Balances</h3>
          {balances.length === 0 ? (
            <p className="text-slate-400 text-center py-8">Add expenses to see balances</p>
          ) : (
            <div className="space-y-2">
              {balances.map(b => (
                <div key={b.userId} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                  <button
                    onClick={() => setExpandedBalance(expandedBalance === b.userId ? null : b.userId)}
                    className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
                  >
                    <span className="font-medium text-slate-900">{b.userName}</span>
                    <div className="flex items-center gap-2">
                      <span className={`font-bold ${b.netAmount > 0.01 ? 'text-emerald-600' : b.netAmount < -0.01 ? 'text-red-500' : 'text-slate-400'}`}>
                        {b.netAmount > 0.01 ? '+' : ''}{formatINR(b.netAmount)}
                      </span>
                      {expandedBalance === b.userId ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </button>
                  {expandedBalance === b.userId && b.details.length > 0 && (
                    <div className="border-t border-slate-100 p-4 bg-slate-50 space-y-2">
                      {b.details.map((d, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <div>
                            <span className="text-slate-700">{d.description}</span>
                            <span className="text-slate-400 ml-2 text-xs">{d.date}</span>
                          </div>
                          <span className={d.amount > 0 ? 'text-emerald-600 font-medium' : 'text-red-500 font-medium'}>
                            {d.amount > 0 ? '+' : ''}{formatINR(d.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {debts.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Simplified Debts</h3>
            <div className="space-y-2">
              {debts.map((d, idx) => (
                <div key={idx} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                  <button
                    onClick={() => setExpandedDebt(expandedDebt === idx ? null : idx)}
                    className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-red-600">{d.fromName}</span>
                      <ArrowRight className="w-4 h-4 text-slate-300" />
                      <span className="font-medium text-emerald-600">{d.toName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">{formatINR(d.amount)}</span>
                      {expandedDebt === idx ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </button>
                  {expandedDebt === idx && d.details.length > 0 && (
                    <div className="border-t border-slate-100 p-4 bg-slate-50 space-y-1">
                      {d.details.map((det, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span className="text-slate-700">{det.description} <span className="text-slate-400 text-xs">{det.date}</span></span>
                          <span className={det.amount > 0 ? 'text-emerald-600' : 'text-red-500'}>{formatINR(det.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Members Tab ───
  function MembersTab() {
    const active = members.filter(m => !m.left_at);
    const past   = members.filter(m => m.left_at);

    const AVATAR_COLORS = [
      'bg-teal-100 text-teal-700', 'bg-sky-100 text-sky-700',
      'bg-violet-100 text-violet-700', 'bg-amber-100 text-amber-700',
      'bg-rose-100 text-rose-700', 'bg-emerald-100 text-emerald-700',
    ];

    return (
      <div className="space-y-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
              Active Members ({active.length})
            </h3>
            <button onClick={() => setShowAddMember(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 transition-colors"
            >
              <UserPlus className="w-4 h-4" /> Add Member
            </button>
          </div>
          <div className="space-y-2">
            {active.map((m, idx) => (
              <div key={m.id} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${AVATAR_COLORS[idx % AVATAR_COLORS.length]}`}>
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-900">{m.name}</p>
                      {m.user_id && (
                        <span className="text-xs bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded font-medium">account</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 flex items-center gap-1">
                      <CalendarDays className="w-3 h-3" /> Joined {m.joined_at}
                    </p>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    const today = new Date().toISOString().split('T')[0];
                    const { error } = await supabase.from('members').update({ left_at: today }).eq('id', m.id);
                    if (error) { toast('error', `Failed to remove: ${error.message}`); return; }
                    toast('info', `${m.name} marked as left`);
                    loadGroup();
                  }}
                  className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors"
                >
                  <LogOut className="w-3 h-3 inline mr-1" /> Remove
                </button>
              </div>
            ))}
          </div>
        </div>

        {past.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Past Members</h3>
            <div className="space-y-2">
              {past.map(m => (
                <div key={m.id} className="bg-slate-50 rounded-xl p-4 border border-slate-100 flex items-center opacity-60">
                  <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-sm mr-3">
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-slate-700">{m.name}</p>
                    <p className="text-xs text-slate-400">{m.joined_at} to {m.left_at}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Import Tab ───
  function ImportTab() {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100 text-center">
          <div className="w-16 h-16 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center mx-auto mb-4">
            <FileDown className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">Import Expenses from CSV</h3>
          <p className="text-slate-500 text-sm max-w-md mx-auto mb-2">
            Columns: <code className="bg-slate-100 px-1 rounded">date, description, amount, currency, paid_by, split_type, split_with, notes, share_details</code>
          </p>
          <p className="text-slate-400 text-xs mb-6">
            Member names in the CSV are matched against this group's member list (case-insensitive).
          </p>
          <label className="inline-flex items-center gap-2 px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-semibold cursor-pointer transition-colors">
            <Upload className="w-5 h-5" /> Choose CSV File
            <input type="file" accept=".csv" className="hidden"
              onChange={async e => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const result = await parseCSV(file, groupId, members);
                  setImportReport(result.report);
                  setImportStats({ imported: result.imported, skipped: result.skipped });
                  toast('success', `Imported ${result.imported} rows, skipped ${result.skipped}`);
                  loadGroup();
                } catch (err) {
                  toast('error', 'CSV import failed unexpectedly');
                }
                e.currentTarget.value = '';
              }}
            />
          </label>
        </div>

        {/* Current members quick reference */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <h4 className="font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-teal-600" /> Active Members (use these names in CSV)
          </h4>
          <div className="flex flex-wrap gap-2">
            {members.filter(m => !m.left_at).map(m => (
              <span key={m.id} className="px-3 py-1.5 rounded-lg bg-teal-50 text-teal-700 text-sm font-medium border border-teal-100">
                {m.name}
              </span>
            ))}
          </div>
        </div>

        <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
          <h4 className="font-semibold text-amber-800 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Issues Handled Automatically
          </h4>
          <ul className="text-sm text-amber-700 space-y-1 list-disc list-inside">
            <li>Duplicate rows flagged and skipped</li>
            <li>Amounts with commas ("1,200" to 1200)</li>
            <li>Name normalisation (case-insensitive matching)</li>
            <li>Settlement rows auto-detected and converted</li>
            <li>Percentages normalised if not 100%</li>
            <li>Missing paid_by skipped with notice</li>
            <li>Missing currency assumed INR</li>
            <li>Zero amounts skipped as placeholders</li>
            <li>Ambiguous dates parsed with warning</li>
            <li>Inactive members (Meera in April) removed from splits</li>
            <li>Negative amounts treated as refunds</li>
          </ul>
        </div>
      </div>
    );
  }

  // ─── Import Report Modal ───
  function ImportReportModal() {
    if (!importReport) return null;
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[80vh] shadow-2xl flex flex-col">
          <div className="p-6 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-900">Import Report</h3>
              <button onClick={() => { setImportReport(null); setImportStats(null); }} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button>
            </div>
            {importStats && (
              <div className="flex gap-4 mt-3">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-medium">
                  <Check className="w-4 h-4" /> {importStats.imported} imported
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium">
                  <AlertTriangle className="w-4 h-4" /> {importStats.skipped} skipped
                </span>
              </div>
            )}
          </div>
          <div className="overflow-auto p-6 flex-1">
            {importReport.length === 0 ? (
              <p className="text-center text-slate-400 py-8">No issues found — all rows imported cleanly.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 px-3 text-slate-500 font-semibold w-12">Row</th>
                    <th className="text-left py-2 px-3 text-slate-500 font-semibold">Description</th>
                    <th className="text-left py-2 px-3 text-slate-500 font-semibold">Issue Found</th>
                    <th className="text-left py-2 px-3 text-slate-500 font-semibold">Action Taken</th>
                  </tr>
                </thead>
                <tbody>
                  {importReport.map((r, i) => (
                    <tr key={i} className={`border-b border-slate-100 ${r.issueFound === 'None' ? '' : 'bg-amber-50/40'}`}>
                      <td className="py-2 px-3 text-slate-400">{r.row}</td>
                      <td className="py-2 px-3 text-slate-700 font-medium">{r.description}</td>
                      <td className="py-2 px-3 text-amber-600">{r.issueFound}</td>
                      <td className="py-2 px-3 text-slate-500">{r.actionTaken}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="p-6 border-t border-slate-100">
            <button onClick={() => { setImportReport(null); setImportStats(null); }} className="w-full py-3 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700 transition-colors">
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Add Expense Modal ───
  function AddExpenseModal() {
    const activeMembers = members.filter(m => !m.left_at);
    const myMember = members.find(m => m.user_id === user?.id);

    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('INR');
    const [paidBy, setPaidBy] = useState(myMember?.id ?? activeMembers[0]?.id ?? '');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [splitType, setSplitType] = useState<'equal' | 'unequal' | 'percentage' | 'share'>('equal');
    const [splitWith, setSplitWith] = useState<string[]>(activeMembers.map(m => m.id));
    const [shareDetails, setShareDetails] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    async function handleSave() {
      if (!description.trim() || !amount) { setError('Description and amount are required'); return; }
      if (splitType === 'equal' && splitWith.length === 0) { setError('Select at least one person to split with'); return; }
      setSaving(true); setError('');

      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount <= 0) { setError('Invalid amount'); setSaving(false); return; }
      const amountInr = currency === 'USD' ? numAmount * 83.5 : numAmount;

      try {
        const { data: expData, error: expError } = await supabase.from('expenses').insert({
          group_id: groupId,
          description: description.trim(),
          amount_inr: amountInr,
          original_amount: numAmount,
          currency,
          exchange_rate: currency === 'USD' ? 83.5 : 1,
          paid_by: paidBy,
          date,
          split_type: splitType,
          is_settlement: false,
        }).select('id').single();

        if (expError || !expData) { setError(expError?.message ?? 'Failed to add expense'); setSaving(false); return; }

        const splitInserts: { expense_id: string; user_id: string; amount_owed: number }[] = [];

        if (splitType === 'equal') {
          const per = amountInr / splitWith.length;
          for (const id of splitWith) splitInserts.push({ expense_id: expData.id, user_id: id, amount_owed: Math.round(per * 100) / 100 });
        } else if (splitType === 'unequal') {
          for (const part of shareDetails.split(',')) {
            const [name, amt] = part.split(':').map(s => s.trim());
            const m = activeMembers.find(m => m.name.toLowerCase() === name?.toLowerCase());
            if (m && amt) splitInserts.push({ expense_id: expData.id, user_id: m.id, amount_owed: parseFloat(amt) });
          }
          if (splitInserts.length === 0) {
            const per = amountInr / splitWith.length;
            for (const id of splitWith) splitInserts.push({ expense_id: expData.id, user_id: id, amount_owed: Math.round(per * 100) / 100 });
          }
        } else if (splitType === 'percentage') {
          for (const part of shareDetails.split(',')) {
            const [name, pct] = part.split(':').map(s => s.trim());
            const m = activeMembers.find(m => m.name.toLowerCase() === name?.toLowerCase());
            if (m && pct) splitInserts.push({ expense_id: expData.id, user_id: m.id, amount_owed: Math.round(amountInr * parseFloat(pct) / 100 * 100) / 100 });
          }
        } else if (splitType === 'share') {
          let total = 0;
          const we: { id: string; w: number }[] = [];
          for (const part of shareDetails.split(',')) {
            const [name, w] = part.split(':').map(s => s.trim());
            const m = activeMembers.find(m => m.name.toLowerCase() === name?.toLowerCase());
            if (m && w) { const weight = parseFloat(w); we.push({ id: m.id, w: weight }); total += weight; }
          }
          for (const e of we) splitInserts.push({ expense_id: expData.id, user_id: e.id, amount_owed: total > 0 ? Math.round(amountInr * e.w / total * 100) / 100 : 0 });
        }

        if (splitInserts.length === 0) { setError('No valid splits calculated. Check format.'); setSaving(false); return; }

        const { error: splitError } = await supabase.from('expense_splits').insert(splitInserts);
        if (splitError) { setError(splitError.message); setSaving(false); return; }

        setShowAddExpense(false);
        toast('success', `Expense "${description.trim()}" added!`);
        loadGroup();
      } catch { setError('Unexpected error'); }
      setSaving(false);
    }

    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setShowAddExpense(false); }}>
        <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] shadow-2xl flex flex-col">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-xl font-bold text-slate-900">Add Expense</h3>
            <button onClick={() => setShowAddExpense(false)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-6 overflow-auto space-y-4 flex-1">
            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none text-slate-900" placeholder="e.g., Groceries from BigBasket" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Amount</label>
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-teal-500 outline-none text-slate-900" placeholder="0" step="0.01" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Currency</label>
                <select value={currency} onChange={e => setCurrency(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-teal-500 outline-none text-slate-900 bg-white">
                  <option value="INR">INR</option>
                  <option value="USD">USD (@ 83.5)</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Paid By</label>
                <select value={paidBy} onChange={e => setPaidBy(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-teal-500 outline-none text-slate-900 bg-white">
                  {activeMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-teal-500 outline-none text-slate-900" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Split Type</label>
              <select value={splitType} onChange={e => setSplitType(e.target.value as 'equal' | 'unequal' | 'percentage' | 'share')} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-teal-500 outline-none text-slate-900 bg-white">
                <option value="equal">Equal</option>
                <option value="unequal">Unequal (fixed amounts)</option>
                <option value="percentage">Percentage</option>
                <option value="share">Share (weighted ratio)</option>
              </select>
            </div>
            {splitType === 'equal' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Split With</label>
                <div className="flex flex-wrap gap-2">
                  {activeMembers.map(m => (
                    <button key={m.id}
                      onClick={() => setSplitWith(prev => prev.includes(m.id) ? prev.filter(id => id !== m.id) : [...prev, m.id])}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${splitWith.includes(m.id) ? 'bg-teal-100 text-teal-700 border border-teal-200' : 'bg-slate-50 text-slate-400 border border-slate-200'}`}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {splitType !== 'equal' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {splitType === 'unequal' ? 'Name:Amount (e.g., Aisha:500,Priya:300)' :
                   splitType === 'percentage' ? 'Name:Percent (e.g., Aisha:40,Priya:60)' :
                   'Name:Weight (e.g., Aisha:2,Priya:1)'}
                </label>
                <input value={shareDetails} onChange={e => setShareDetails(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-teal-500 outline-none text-slate-900"
                  placeholder={splitType === 'unequal' ? 'Aisha:500,Priya:300' : splitType === 'percentage' ? 'Aisha:40,Priya:60' : 'Aisha:2,Priya:1'} />
              </div>
            )}
          </div>
          <div className="p-6 border-t border-slate-100">
            <button onClick={handleSave} disabled={saving} className="w-full py-3 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700 transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : 'Add Expense'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Add Member Modal (name-only — no account required) ───
  function AddMemberModal() {
    const [name, setName] = useState('');
    const [joinDate, setJoinDate] = useState(new Date().toISOString().split('T')[0]);
    const [leaveDate, setLeaveDate] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    async function handleAdd() {
      if (!name.trim()) { setError('Name is required'); return; }
      const already = members.find(m => m.name.toLowerCase() === name.trim().toLowerCase() && !m.left_at);
      if (already) { setError(`${name.trim()} is already an active member`); return; }
      setSaving(true); setError('');

      const { error: err } = await supabase.from('members').insert({
        group_id: groupId,
        name: name.trim(),
        user_id: null,
        joined_at: joinDate,
        left_at: leaveDate || null,
      });

      if (err) { setError(err.message); setSaving(false); return; }
      toast('success', `${name.trim()} added to group!`);
      setShowAddMember(false);
      loadGroup();
    }

    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setShowAddMember(false); }}>
        <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-xl font-bold text-slate-900">Add Member</h3>
            <button onClick={() => setShowAddMember(false)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-6 space-y-4">
            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Name <span className="text-red-500">*</span></label>
              <input
                value={name} onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                autoFocus
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none text-slate-900"
                placeholder="e.g., Aisha"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Join Date <span className="text-red-500">*</span></label>
              <input type="date" value={joinDate} onChange={e => setJoinDate(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-teal-500 outline-none text-slate-900" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Leave Date <span className="text-slate-400 font-normal">(optional)</span></label>
              <input type="date" value={leaveDate} onChange={e => setLeaveDate(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-teal-500 outline-none text-slate-900" />
              <p className="text-xs text-slate-400 mt-1">Fill in if this member has already left the group.</p>
            </div>
          </div>
          <div className="p-6 border-t border-slate-100 flex gap-3">
            <button onClick={() => setShowAddMember(false)} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={handleAdd} disabled={saving} className="flex-1 py-3 rounded-xl bg-teal-600 text-white font-semibold hover:bg-teal-700 transition-colors disabled:opacity-50">
              {saving ? 'Adding…' : 'Add Member'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Settle Modal ───
  function SettleModal() {
    const activeMembers = members.filter(m => !m.left_at);
    const myMember = members.find(m => m.user_id === user?.id);
    const [paidBy, setPaidBy] = useState(myMember?.id ?? activeMembers[0]?.id ?? '');
    const [paidTo, setPaidTo] = useState('');
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    async function handleSettle() {
      if (!paidTo || !amount) { setError('All fields are required'); return; }
      if (paidBy === paidTo) { setError('Cannot settle with yourself'); return; }
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount <= 0) { setError('Invalid amount'); return; }
      setSaving(true); setError('');

      const { error: err } = await supabase.from('settlements').insert({
        group_id: groupId, paid_by: paidBy, paid_to: paidTo, amount: numAmount, date,
      });

      if (err) { setError(err.message); setSaving(false); return; }
      setShowSettle(false);
      toast('success', 'Settlement recorded!');
      loadGroup();
      setSaving(false);
    }

    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setShowSettle(false); }}>
        <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-xl font-bold text-slate-900">Record Settlement</h3>
            <button onClick={() => setShowSettle(false)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-6 space-y-4">
            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Who paid</label>
              <select value={paidBy} onChange={e => setPaidBy(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-teal-500 outline-none text-slate-900 bg-white">
                {activeMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Paid to</label>
              <select value={paidTo} onChange={e => setPaidTo(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-teal-500 outline-none text-slate-900 bg-white">
                <option value="">Select person</option>
                {activeMembers.filter(m => m.id !== paidBy).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Amount (INR)</label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-teal-500 outline-none text-slate-900" placeholder="0" step="0.01" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-teal-500 outline-none text-slate-900" />
            </div>
          </div>
          <div className="p-6 border-t border-slate-100">
            <button onClick={handleSettle} disabled={saving} className="w-full py-3 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700 transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : 'Record Settlement'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
