import { useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { fmtD } from '../lib/format';
import { supabase } from '../lib/supabase';
import { Avatar, I, Sheet, tap } from './kit';

export interface Contact {
  id: string; name: string; phone: string; source: 'manual' | 'buyer' | 'lead' | 'import';
  marketing_ok: boolean; consent_at: string | null; opted_out_at: string | null;
  interest_project: string | null; note: string | null; created_at: string;
}

export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const all: Contact[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from('contacts').select('id, name, phone, source, marketing_ok, consent_at, opted_out_at, interest_project, note, created_at')
        .order('created_at', { ascending: false }).range(from, from + 999);
      all.push(...((data ?? []) as Contact[]));
      if (!data || data.length < 1000) break;
    }
    setContacts(all);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { contacts, loaded, reload: load };
}

type Filter = 'all' | 'ok' | 'ask' | 'stopped';

/** Customers the company may contact; who agreed to hear about new projects, and who said STOP. */
export function MContacts() {
  const { isOwner, canSell, rpc, toast } = useData();
  const { contacts, loaded, reload } = useContacts();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [edit, setEdit] = useState<Contact | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  const counts = useMemo(() => ({
    all: contacts.length,
    ok: contacts.filter((c) => c.marketing_ok && !c.opted_out_at).length,
    ask: contacts.filter((c) => !c.marketing_ok && !c.opted_out_at).length,
    stopped: contacts.filter((c) => c.opted_out_at).length,
  }), [contacts]);
  const shown = contacts.filter((c) => {
    if (filter === 'ok' && !(c.marketing_ok && !c.opted_out_at)) return false;
    if (filter === 'ask' && (c.marketing_ok || c.opted_out_at)) return false;
    if (filter === 'stopped' && !c.opted_out_at) return false;
    const s = q.trim().toLowerCase();
    return !s || c.name.toLowerCase().includes(s) || c.phone.replace(/\D/g, '').includes(s.replace(/\D/g, '') || '\u0000');
  });

  if (!canSell) return <div className="m-page"><div className="m-card m-empty"><b>Customers are for the owner and sales team</b></div></div>;

  const importBuyers = async () => {
    tap();
    setBusy(true);
    const n = await rpc<number>('import_buyers', {});
    setBusy(false);
    if (n != null) { toast(n ? `Added ${n} buyer${n === 1 ? '' : 's'}. Tick "agreed to offers" for those who said yes.` : 'Every buyer is already in your list'); reload(); }
  };

  return (
    <div className="m-page">
      <header className="m-head">
        <button className="m-iconbtn" aria-label="Back" onClick={() => { tap(); go('/more'); }}><I n="back" sw={2.4} /></button>
        <div className="t"><small>{counts.ok} agreed to offers</small><h1 style={{ fontSize: '1.6rem' }}>Customers</h1></div>
        <button className="m-iconbtn" aria-label="Add a customer" onClick={() => { tap(); setEdit('new'); }}><I n="plus" sw={2.4} /></button>
      </header>
      <div className="m-stack">
        {isOwner && (
          <button className="m-card m-bc-cta" onClick={() => { tap(); go('/broadcast'); }}>
            <span className="ic">📣</span>
            <span className="tx"><b>Announce a project on WhatsApp</b><span>Send to the {counts.ok} customer{counts.ok === 1 ? '' : 's'} who agreed to offers</span></span>
            <span className="chev"><I n="chev" /></span>
          </button>
        )}
        <label className="m-field"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or number" /></label>
        <div className="m-chips">
          {([['all', 'All'], ['ok', 'Agreed'], ['ask', 'Not asked yet'], ['stopped', 'Said STOP']] as [Filter, string][]).map(([k, l]) => (
            <button key={k} className={`m-chip${filter === k ? ' on' : ''}`} onClick={() => { tap(); setFilter(k); }}>{l}<em>{counts[k]}</em></button>
          ))}
        </div>

        {loaded && contacts.length === 0 ? (
          <div className="m-card m-empty">
            <div className="art">👥</div><b>No customers yet</b>
            Add people who visited the site or enquired, or bring in everyone who bought from you.
            <div style={{ marginTop: 14 }}><button className="m-btn sm" disabled={busy} onClick={importBuyers}>Add my buyers</button></div>
          </div>
        ) : (
          <section className="m-card" style={{ paddingBlock: 4 }}>
            <div className="m-list">
              {shown.slice(0, 300).map((c) => (
                <button key={c.id} className="m-row" onClick={() => { tap(); setEdit(c); }}>
                  <Avatar id={c.id} name={c.name} size={38} />
                  <div className="body"><b>{c.name}</b><span>{c.phone}{c.source === 'buyer' ? ' · buyer' : ''}</span></div>
                  <span className={`m-pill ${c.opted_out_at ? 'st-available' : c.marketing_ok ? 'st-sold' : 'st-booked'}`}>{c.opted_out_at ? 'STOP' : c.marketing_ok ? 'Agreed' : 'Ask'}</span>
                </button>
              ))}
              {!shown.length && <p className="m-sub m-small" style={{ padding: '14px 0' }}>No one matches.</p>}
            </div>
          </section>
        )}
        {contacts.length > 0 && <button className="m-btn ghost" disabled={busy} onClick={importBuyers}>Add buyers who aren't in the list yet</button>}
        <p className="m-sub m-small" style={{ textAlign: 'center' }}>Only tick "agreed to offers" when the customer said yes. WhatsApp blocks numbers that message people who did not agree.</p>
      </div>
      <ContactSheet contact={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </div>
  );
}

function ContactSheet({ contact, onClose, onSaved }: { contact: Contact | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const { rpc, isOwner, projects } = useData();
  const isNew = contact === 'new';
  const c = contact && contact !== 'new' ? contact : null;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [ok, setOk] = useState(false);
  const [project, setProject] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(c?.name ?? ''); setPhone(c?.phone ?? ''); setOk(!!c?.marketing_ok && !c?.opted_out_at);
    setProject(c?.interest_project ?? ''); setNote(c?.note ?? '');
  }, [contact]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    const r = await rpc('save_contact', { p_id: c?.id ?? null, p: { name, phone, marketing_ok: ok, interest_project: project, note } }, isNew ? 'Customer added' : 'Saved');
    setBusy(false);
    if (r) onSaved();
  };
  const remove = async () => {
    if (!c || !confirm(`Remove ${c.name} from your customers?`)) return;
    if (await rpc('delete_contact', { p_id: c.id }, 'Removed')) onSaved();
  };

  return (
    <Sheet open={!!contact} onClose={onClose}>
      <h2>{isNew ? 'Add a customer' : c?.name}</h2>
      {c?.opted_out_at && <p className="m-small" style={{ color: 'var(--m-red)', fontWeight: 700 }}>Replied STOP on {fmtD(c.opted_out_at)}. Only tick the box again if they asked to hear from you.</p>}
      {c?.marketing_ok && c.consent_at && !c.opted_out_at && <p className="m-sub m-small">Agreed to offers on {fmtD(c.consent_at)}.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        <label className="m-field">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer's name" /></label>
        <label className="m-field">Mobile (WhatsApp)<input value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" /></label>
        <label className="m-field">Interested in
          <select className="m-select" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">Any project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="m-field">Note (optional)<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Visited the site on Sunday" /></label>
        <label className="m-consent">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          <span><b>Agreed to get new project offers on WhatsApp</b>The customer said yes to hearing about new projects. They can reply STOP at any time.</span>
        </label>
        <button className="m-btn" disabled={busy || !name.trim() || !phone.trim()} onClick={save}>{busy ? 'Saving…' : isNew ? 'Add customer' : 'Save'}</button>
        {c && isOwner && <button className="m-btn ghost" onClick={remove}>Remove customer</button>}
      </div>
    </Sheet>
  );
}
