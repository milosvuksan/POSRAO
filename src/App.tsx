import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { ClockIcon, LogoMark, MoonIcon, PingPongIcon, PoolIcon, SunIcon, UsersIcon } from './icons';
import type { Control, PublicEntry, PublicState, ResourceId, ResourceState } from './types';

const CONTROL_KEY = 'igraonica-control';

function loadControl(): Control | null {
  try { return JSON.parse(localStorage.getItem(CONTROL_KEY) || 'null'); } catch { return null; }
}

function storeControl(control: Control | null) {
  if (control) localStorage.setItem(CONTROL_KEY, JSON.stringify(control));
  else localStorage.removeItem(CONTROL_KEY);
}

function mmss(milliseconds: number) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function waitLabel(milliseconds: number) {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  return minutes === 1 ? 'oko 1 min' : `oko ${minutes} min`;
}

export default function App() {
  const [state, setState] = useState<PublicState | null>(null);
  const [control, setControl] = useState<Control | null>(loadControl);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());
  const serverOffset = useRef(0);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const [sheet, setSheet] = useState<{ kind: 'book'; resource: ResourceState } | { kind: 'recover' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);

  const updateState = (next: PublicState) => {
    serverOffset.current = next.serverTime - Date.now();
    setState(next);
    setNow(Date.now() + serverOffset.current);
  };

  useEffect(() => {
    api.state().then(updateState).catch(() => setToast({ text: 'Nije moguće povezivanje sa serverom.', error: true }));
    const events = new EventSource('/api/events');
    events.addEventListener('state', event => {
      updateState(JSON.parse((event as MessageEvent).data));
      setConnected(true);
    });
    events.onerror = () => setConnected(false);
    const clock = window.setInterval(() => setNow(Date.now() + serverOffset.current), 500);
    return () => { events.close(); window.clearInterval(clock); };
  }, []);

  const liveIds = useMemo(() => new Set(state?.resources.flatMap(resource => [resource.active, ...resource.queue].filter(Boolean).map(entry => entry!.entryId)) ?? []), [state]);
  useEffect(() => {
    if (control && state && !liveIds.has(control.entryId)) {
      setControl(null);
      storeControl(null);
    }
  }, [control, liveIds, state]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('igraonica-theme', next);
  };

  const act = async (action: 'extend' | 'finish' | 'cancel') => {
    if (!control) return;
    if (action === 'finish' && !window.confirm('Završiti sesiju i osloboditi sto?')) return;
    if (action === 'cancel' && !window.confirm('Napustiti red čekanja?')) return;
    setBusy(action);
    try {
      const result = await api[action](control.entryId, control.token);
      updateState(result.stateSnapshot);
      if (action !== 'extend') { setControl(null); storeControl(null); }
      setToast({ text: action === 'extend' ? 'Dodato je još 15 minuta.' : action === 'finish' ? 'Sesija je završena.' : 'Napustili ste red.' });
    } catch (error) {
      setToast({ text: error instanceof ApiError ? error.message : 'Pokušajte ponovo.', error: true });
    } finally { setBusy(null); }
  };

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Na potezu, početna">
        <span className="lpetnicatenisogo"><LogoMark /></span>
        <span><strong>Na potezu</strong><small>Petnica igraonica</small></span>
      </a>
      <div className="header-actions">
        <span className={`connection ${connected ? 'online' : ''}`}><i />{connected ? 'Uživo' : 'Povezivanje'}</span>
        <button className="icon-button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Uključi svetlu temu' : 'Uključi tamnu temu'}>
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </header>

    <main id="top">
      <section className="hero">
        <p className="eyebrow"><span /> Bez rezervacije unapred</p>
        <h1>Izaberi igru.<br/><em>Počni kada si na redu.</em></h1>
        <p className="intro">Proveri dostupnost, zauzmi slobodan sto ili stani u red. Jednostavno i fer.</p>
      </section>

      {!state ? <LoadingCards /> : <section className="game-grid" aria-label="Dostupni stolovi">
        {state.resources.map((resource, index) => <GameCard
          key={resource.id}
          resource={resource}
          control={control}
          now={now}
          delay={index}
          busy={busy}
          onOpen={() => setSheet({ kind: 'book', resource })}
          onExtend={() => act('extend')}
          onFinish={() => act('finish')}
          onCancel={() => act('cancel')}
        />)}
      </section>}

      <button className="recover-link" onClick={() => setSheet({ kind: 'recover' })}>
        Već imaš prijavu? <strong>Poveži se imenom i PIN-om →</strong>
      </button>

      <section className="how-it-works">
        <div><b>01</b><span><strong>Izaberi sto</strong><small>Vidi stanje uživo</small></span></div>
        <i />
        <div><b>02</b><span><strong>Unesi podatke</strong><small>Ime, PIN i vreme</small></span></div>
        <i />
        <div><b>03</b><span><strong>Igraj</strong><small>Mi pratimo vreme</small></span></div>
      </section>
    </main>

    <footer><span>Na potezu</span><small>Prvi dođe, prvi igra.</small></footer>

    {sheet?.kind === 'book' && <BookingSheet resource={sheet.resource} onClose={() => setSheet(null)} onSuccess={(result) => {
      const next = { entryId: result.entryId!, token: result.token! };
      setControl(next); storeControl(next); updateState(result.stateSnapshot); setSheet(null);
      setToast({ text: result.state === 'active' ? 'Sto je tvoj. Vreme počinje sada!' : 'Dodat/a si u red čekanja.' });
    }} />}
    {sheet?.kind === 'recover' && <RecoverySheet onClose={() => setSheet(null)} onSuccess={(result) => {
      const next = { entryId: result.entryId!, token: result.token! };
      setControl(next); storeControl(next); updateState(result.stateSnapshot); setSheet(null); setToast({ text: 'Ponovo si povezan/a sa prijavom.' });
    }} />}
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role="status"><span>{toast.error ? '!' : '✓'}</span>{toast.text}</div>}
  </div>;
}

function GameCard({ resource, control, now, delay, busy, onOpen, onExtend, onFinish, onCancel }: {
  resource: ResourceState; control: Control | null; now: number; delay: number; busy: string | null;
  onOpen: () => void; onExtend: () => void; onFinish: () => void; onCancel: () => void;
}) {
  const active = resource.active;
  const myActive = active?.entryId === control?.entryId;
  const myQueue = resource.queue.find(entry => entry.entryId === control?.entryId);
  const queueExists = resource.queue.length > 0;
  const durationMs = active ? active.durationMinutes * 60_000 : 1;
  const remaining = active?.endsAt ? active.endsAt - now : 0;
  const elapsedPercent = active ? Math.min(100, Math.max(0, 100 - remaining / durationMs * 100)) : 0;
  const unavailable = Boolean(control && !myActive && !myQueue);

  return <article className={`game-card ${resource.id} ${active ? 'occupied' : 'available'}`} style={{ animationDelay: `${delay * 90}ms` }}>
    <div className="card-top">
      <div className="game-art">{resource.id === 'billiards' ? <PoolIcon /> : <PingPongIcon />}</div>
      <span className="status"><i />{active ? 'Zauzeto' : 'Slobodno'}</span>
    </div>
    <div className="game-heading">
      <p>{resource.id === 'billiards' ? 'Sto 01' : 'Sto 02'}</p>
      <h2>{resource.label}</h2>
    </div>

    {active ? <>
      <div className="active-player"><span>Trenutno igra</span><strong>{active.displayName}</strong></div>
      <div className="timer-row"><span className="round-icon"><ClockIcon /></span><div><small>Preostalo vreme</small><strong>{mmss(remaining)}</strong></div></div>
      <div className="progress"><span style={{ width: `${elapsedPercent}%` }} /></div>
      {myActive ? <div className="owner-actions">
        <button className="primary" disabled={queueExists || Boolean(busy)} onClick={onExtend}>+ 15 min</button>
        <button className="secondary danger" disabled={Boolean(busy)} onClick={onFinish}>{busy === 'finish' ? 'Završavam…' : 'Završi'}</button>
        {queueExists && <small className="action-note">Produženje nije dostupno dok neko čeka.</small>}
      </div> : myQueue ? <div className="my-position">
        <span>Ti si <strong>{myQueue.position}.</strong> u redu</span>
        <button className="secondary" disabled={Boolean(busy)} onClick={onCancel}>{busy === 'cancel' ? 'Napuštam…' : 'Napusti red'}</button>
      </div> : <button className="primary full" disabled={unavailable} onClick={onOpen}>{unavailable ? 'Već imaš prijavu' : 'Stani u red'} <span>→</span></button>}
    </> : <>
      <div className="free-message"><strong>Sto je slobodan</strong><span>Vreme počinje odmah nakon prijave.</span></div>
      <button className="primary full" disabled={unavailable} onClick={onOpen}>{unavailable ? 'Već imaš prijavu' : 'Zauzmi sto'} <span>→</span></button>
    </>}

    <Queue resource={resource} now={now} myId={control?.entryId} />
  </article>;
}

function Queue({ resource, now, myId }: { resource: ResourceState; now: number; myId?: string }) {
  return <div className="queue-block">
    <div className="queue-title"><span><UsersIcon /> Red čekanja</span><b>{resource.queue.length}</b></div>
    {resource.queue.length === 0 ? <p className="empty-queue">Niko ne čeka — produženje je moguće.</p> : <ol>
      {resource.queue.map(entry => <li key={entry.entryId} className={entry.entryId === myId ? 'mine' : ''}>
        <span className="position">{entry.position}</span>
        <span className="avatar">{entry.displayName.charAt(0).toUpperCase()}</span>
        <span className="queue-name"><strong>{entry.displayName}{entry.entryId === myId ? ' (ti)' : ''}</strong><small>{entry.durationMinutes} min igre</small></span>
        <span className="wait">{waitLabel((entry.estimatedStartAt ?? now) - now)}</span>
      </li>)}
    </ol>}
  </div>;
}

function BookingSheet({ resource, onClose, onSuccess }: { resource: ResourceState; onClose: () => void; onSuccess: (result: Awaited<ReturnType<typeof api.create>>) => void }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [duration, setDuration] = useState(15);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const queued = Boolean(resource.active);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSubmitting(true);
    try { onSuccess(await api.create(resource.id, { name, pin, durationMinutes: duration })); }
    catch (problem) { setError(problem instanceof ApiError ? problem.message : 'Pokušajte ponovo.'); setSubmitting(false); }
  };
  return <Sheet title={queued ? `Stani u red za ${resource.label.toLocaleLowerCase('sr-Latn')}` : `Zauzmi ${resource.label.toLocaleLowerCase('sr-Latn')}`} onClose={onClose}>
    <p className="sheet-intro">{queued ? 'Tvoja sesija počinje automatski kada dođeš na red.' : 'Sto je slobodan. Odbrojavanje počinje odmah.'}</p>
    <form onSubmit={submit}>
      <label>Ime i prezime<input autoFocus autoComplete="name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={30} placeholder="npr. Mila Petrović" required /></label>
      <label>Četvorocifreni PIN<input inputMode="numeric" autoComplete="off" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} pattern="\d{4}" placeholder="••••" required /><small>Zapamti PIN — njime upravljaš svojom prijavom.</small></label>
      <fieldset><legend>Koliko želiš da igraš?</legend><div className="duration-display"><strong>{duration}</strong><span>minuta</span></div>
        <input className="duration-range" type="range" min="5" max="60" step="5" value={duration} onChange={event => setDuration(Number(event.target.value))} aria-label="Trajanje u minutima" />
        <div className="range-labels"><span>5 min</span><span>30 min</span><span>60 min</span></div>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary full submit" disabled={submitting}>{submitting ? 'Prijavljujem…' : queued ? 'Stani u red' : 'Počni sada'} <span>→</span></button>
    </form>
  </Sheet>;
}

function RecoverySheet({ onClose, onSuccess }: { onClose: () => void; onSuccess: (result: Awaited<ReturnType<typeof api.recover>>) => void }) {
  const [name, setName] = useState(''); const [pin, setPin] = useState(''); const [error, setError] = useState(''); const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSubmitting(true);
    try { onSuccess(await api.recover({ name, pin })); }
    catch (problem) { setError(problem instanceof ApiError ? problem.message : 'Pokušajte ponovo.'); setSubmitting(false); }
  };
  return <Sheet title="Poveži se sa prijavom" onClose={onClose}>
    <p className="sheet-intro">Unesi iste podatke koje si koristio/la pri prijavi.</p>
    <form onSubmit={submit}>
      <label>Ime i prezime<input autoFocus autoComplete="name" value={name} onChange={event => setName(event.target.value)} required /></label>
      <label>Četvorocifreni PIN<input inputMode="numeric" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} pattern="\d{4}" placeholder="••••" required /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary full submit" disabled={submitting}>{submitting ? 'Povezujem…' : 'Poveži se'} <span>→</span></button>
    </form>
  </Sheet>;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose(); document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close); }, [onClose]);
  return <div className="sheet-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <button className="sheet-close" onClick={onClose} aria-label="Zatvori">×</button>
      <p className="eyebrow"><span /> Nova prijava</p><h2 id="sheet-title">{title}</h2>{children}
    </section>
  </div>;
}

function LoadingCards() {
  return <section className="game-grid" aria-label="Učitavanje"><div className="game-card skeleton"/><div className="game-card skeleton"/></section>;
}
