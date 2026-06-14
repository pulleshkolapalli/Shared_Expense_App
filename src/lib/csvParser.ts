import Papa from 'papaparse';
import type { ImportReportRow, Member } from '../types';
import { supabase } from './supabase';

const EXCHANGE_RATE = 83.5;

function normalizeName(raw: string): string {
  if (!raw) return '';
  return raw.trim().replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function cleanAmount(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const str = String(raw).trim().replace(/,/g, '').replace(/\s+/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

function parseAmbiguousDate(raw: string): { date: string; ambiguous: boolean } {
  if (!raw) return { date: '', ambiguous: true };
  const trimmed = raw.trim();

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed)) return { date: trimmed, ambiguous: false };

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, a, b, year] = slashMatch;
    return { date: `${year}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`, ambiguous: parseInt(a) <= 12 && parseInt(b) <= 12 };
  }

  const monthMap: Record<string,string> = {
    jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
    jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
    january:'01',february:'02',march:'03',april:'04',june:'06',
    july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',
  };
  const mMatch = trimmed.match(/^(\w{3,})\s+(\d{1,2})$/i);
  if (mMatch) {
    const month = monthMap[mMatch[1].toLowerCase()];
    if (month) return { date: `${new Date().getFullYear()}-${month}-${mMatch[2].padStart(2,'0')}`, ambiguous: true };
  }

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) return { date: parsed.toISOString().split('T')[0], ambiguous: true };
  return { date: '', ambiguous: true };
}

export async function parseCSV(
  file: File,
  groupId: string,
  members: Member[]
): Promise<{ report: ImportReportRow[]; imported: number; skipped: number }> {
  const report: ImportReportRow[] = [];
  let imported = 0;
  let skipped = 0;

  // Build lookup: lowercase name → member (also first-name-only alias)
  const memberMap = new Map<string, Member>();
  for (const m of members) {
    memberMap.set(m.name.toLowerCase(), m);
    const first = m.name.split(' ')[0].toLowerCase();
    if (!memberMap.has(first)) memberMap.set(first, m);
  }

  function findMember(raw: string): Member | null {
    if (!raw) return null;
    const normalized = normalizeName(raw).toLowerCase();
    return memberMap.get(normalized) ?? memberMap.get(raw.trim().toLowerCase()) ?? null;
  }

  const text = await file.text();
  const parsed = Papa.parse<Record<string,string>>(text, { header: true, skipEmptyLines: true });

  const seenRows = new Set<string>();
  const pending: {
    rowNumber: number; date: string; description: string;
    amountInr: number; originalAmount: number; currency: string;
    paidByMemberId: string; splitType: string;
    splits: { memberId: string; amount_owed: number }[];
  }[] = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    const rowNumber = i + 2;
    const issues: string[] = [];
    const actions: string[] = [];

    const description = (row['description'] || row['Description'] || '').trim();
    if (!description) {
      report.push({ row: rowNumber, description: '(empty)', issueFound: 'Missing description', actionTaken: 'Skipped' });
      skipped++; continue;
    }

    const notes = row['notes'] || row['Notes'] || '';
    const isSettlement = /paid\s+back|settlement/i.test(description) || /paid\s+back|settlement/i.test(notes);

    const amount = cleanAmount(row['amount'] || row['Amount'] || '');
    if (amount === null) {
      report.push({ row: rowNumber, description, issueFound: 'Invalid amount', actionTaken: 'Skipped' });
      skipped++; continue;
    }
    if (amount === 0) {
      report.push({ row: rowNumber, description, issueFound: 'Zero amount', actionTaken: 'Skipped as placeholder' });
      skipped++; continue;
    }
    if (amount < 0) { issues.push('Negative amount'); actions.push('Treated as refund'); }

    const rawPaidBy = (row['paid_by'] || row['Paid By'] || '').trim();
    if (!rawPaidBy) {
      report.push({ row: rowNumber, description, issueFound: 'Missing paid_by', actionTaken: 'Skipped — needs manual entry' });
      skipped++; continue;
    }
    const paidByMember = findMember(rawPaidBy);
    if (!paidByMember) {
      report.push({ row: rowNumber, description, issueFound: `paid_by "${rawPaidBy}" not found in group members`, actionTaken: 'Skipped' });
      skipped++; continue;
    }

    const dupKey = `${row['date']||''}-${description}-${amount}`;
    if (seenRows.has(dupKey)) {
      report.push({ row: rowNumber, description, issueFound: 'Duplicate row', actionTaken: 'Skipped duplicate' });
      skipped++; continue;
    }
    seenRows.add(dupKey);

    let currency = (row['currency'] || row['Currency'] || '').trim().toUpperCase();
    if (!currency) { currency = 'INR'; issues.push('Missing currency'); actions.push('Assumed INR'); }

    const rawDate = row['date'] || row['Date'] || '';
    const { date, ambiguous } = parseAmbiguousDate(rawDate);
    if (!date) {
      report.push({ row: rowNumber, description, issueFound: 'Invalid date', actionTaken: 'Skipped' });
      skipped++; continue;
    }
    if (ambiguous) { issues.push('Ambiguous date format'); actions.push(`Parsed as ${date}`); }

    const splitType = (row['split_type'] || row['Split Type'] || 'equal').trim().toLowerCase();
    const rawSplitWith = row['split_with'] || row['Split With'] || '';
    const splitWithNames = rawSplitWith.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    const shareDetails = row['share_details'] || row['Share Details'] || '';

    if (splitType === 'equal' && shareDetails.trim()) {
      issues.push('Split type "equal" but share details provided');
      actions.push('Used equal split');
    }

    // Resolve participants + activity check
    const expDate = new Date(date);
    const activeParticipants: Member[] = [];
    const namesToCheck = splitWithNames.length > 0 ? splitWithNames : members.map(m => m.name);

    for (const rawName of namesToCheck) {
      const m = findMember(rawName);
      if (!m) {
        if (splitWithNames.length > 0) {
          issues.push(`Non-member "${normalizeName(rawName)}" in split`);
          actions.push('Skipped unknown participant');
        }
        continue;
      }
      const joined = new Date(m.joined_at);
      const left = m.left_at ? new Date(m.left_at) : null;
      if (expDate < joined || (left && expDate > left)) {
        issues.push(`${m.name} not active on ${date}`);
        actions.push(`Removed ${m.name} from split`);
      } else {
        if (!activeParticipants.find(p => p.id === m.id)) activeParticipants.push(m);
      }
    }

    if (!activeParticipants.find(p => p.id === paidByMember.id)) {
      const j = new Date(paidByMember.joined_at);
      const l = paidByMember.left_at ? new Date(paidByMember.left_at) : null;
      if (expDate >= j && (!l || expDate <= l)) activeParticipants.push(paidByMember);
    }

    if (activeParticipants.length === 0) {
      report.push({ row: rowNumber, description, issueFound: 'No active participants resolved', actionTaken: 'Skipped' });
      skipped++; continue;
    }

    const absAmount = Math.abs(amount);
    const amountInr = currency === 'USD' ? absAmount * EXCHANGE_RATE : absAmount;

    let splits: { memberId: string; amount_owed: number }[] = [];

    if (splitType === 'percentage' && shareDetails) {
      let total = 0;
      const pctMap: { m: Member; pct: number }[] = [];
      for (const part of shareDetails.split(/[,;]/)) {
        const match = part.trim().match(/^(.+?)[:=]\s*([\d.]+)%?$/);
        if (match) { const m = findMember(match[1]); if (m) { const p = parseFloat(match[2]); pctMap.push({ m, pct: p }); total += p; } }
      }
      if (total !== 100 && total > 0) {
        issues.push(`Percentages sum to ${total}% not 100%`);
        actions.push('Normalised proportionally');
        const factor = 100 / total;
        pctMap.forEach(e => e.pct *= factor);
      }
      splits = pctMap.map(e => ({ memberId: e.m.id, amount_owed: Math.round(amountInr * e.pct / 100 * 100) / 100 }));
    } else if (splitType === 'unequal' && shareDetails) {
      for (const part of shareDetails.split(/[,;]/)) {
        const match = part.trim().match(/^(.+?)[:=]\s*([\d.]+)$/);
        if (match) { const m = findMember(match[1]); if (m) splits.push({ memberId: m.id, amount_owed: Math.round(parseFloat(match[2]) * 100) / 100 }); }
      }
    } else if (splitType === 'share' && shareDetails) {
      let totalWeight = 0;
      const wm: { m: Member; w: number }[] = [];
      for (const part of shareDetails.split(/[,;]/)) {
        const match = part.trim().match(/^(.+?)[:=]\s*([\d.]+)$/);
        if (match) { const m = findMember(match[1]); if (m) { const w = parseFloat(match[2]); wm.push({ m, w }); totalWeight += w; } }
      }
      splits = wm.map(e => ({ memberId: e.m.id, amount_owed: totalWeight > 0 ? Math.round(amountInr * e.w / totalWeight * 100) / 100 : 0 }));
    }

    if (splits.length === 0) {
      const per = amountInr / activeParticipants.length;
      splits = activeParticipants.map(m => ({ memberId: m.id, amount_owed: Math.round(per * 100) / 100 }));
    }

    if (isSettlement) {
      const payTo = splits.find(s => s.memberId !== paidByMember.id);
      if (payTo) {
        const { error } = await supabase.from('settlements').insert({
          group_id: groupId, paid_by: paidByMember.id, paid_to: payTo.memberId, amount: amountInr, date,
        });
        if (error) { issues.push('Settlement insert failed'); actions.push(error.message); }
        else { issues.push('Settlement row detected'); actions.push('Converted to settlement record'); imported++; }
      }
    } else {
      pending.push({ rowNumber, date, description, amountInr, originalAmount: absAmount, currency, paidByMemberId: paidByMember.id, splitType, splits });
    }

    const issueStr = issues.length > 0 ? issues.join('; ') : 'None';
    const actionStr = actions.length > 0 ? actions.join('; ') : 'Imported';
    report.push({ row: rowNumber, description, issueFound: issueStr, actionTaken: actionStr });
  }

  // Batch insert expenses + splits
  for (const pe of pending) {
    const { data: expData, error: expError } = await supabase.from('expenses').insert({
      group_id: groupId,
      description: pe.description,
      amount_inr: pe.amountInr,
      original_amount: pe.originalAmount,
      currency: pe.currency,
      exchange_rate: EXCHANGE_RATE,
      paid_by: pe.paidByMemberId,
      date: pe.date,
      split_type: pe.splitType,
      is_settlement: false,
    }).select('id').single();

    if (expError || !expData) {
      const idx = report.findIndex(r => r.row === pe.rowNumber);
      const msg = expError?.message ?? 'Unknown error';
      if (idx >= 0) { report[idx].issueFound += '; Insert failed'; report[idx].actionTaken += '; ' + msg; }
      else report.push({ row: pe.rowNumber, description: pe.description, issueFound: 'Insert failed', actionTaken: msg });
      skipped++; continue;
    }

    const { error: splitError } = await supabase.from('expense_splits').insert(
      pe.splits.map(s => ({ expense_id: expData.id, user_id: s.memberId, amount_owed: s.amount_owed }))
    );
    if (splitError) {
      const idx = report.findIndex(r => r.row === pe.rowNumber);
      if (idx >= 0) report[idx].issueFound += `; Split failed: ${splitError.message}`;
      skipped++;
    } else {
      imported++;
    }
  }

  return { report, imported, skipped };
}
