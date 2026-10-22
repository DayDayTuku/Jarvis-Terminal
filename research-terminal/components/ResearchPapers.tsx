'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { trackEvent } from '../lib/analytics-client';

type Paper = {
  id: string;
  title: string;
  summary: string | null;
  sector: string | null;
  published_on: string;
  file_name: string;
  file_size: number;
  created_at: string;
  signed_url: string | null;
};

export default function ResearchPapers() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [canUpload, setCanUpload] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [title, setTitle] = useState('');
  const [sector, setSector] = useState('');
  const [summary, setSummary] = useState('');
  const [publishedOn, setPublishedOn] = useState(new Date().toISOString().slice(0, 10));
  const [query, setQuery] = useState('');
  const [sectorFilter, setSectorFilter] = useState('ALL');
  const fileRef = useRef<HTMLInputElement>(null);
  const sectors = ['ALL', ...new Set(papers.map((paper) => paper.sector).filter((value): value is string => Boolean(value)))];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredPapers = papers.filter((paper) => {
    if (sectorFilter !== 'ALL' && paper.sector !== sectorFilter) return false;
    if (!normalizedQuery) return true;
    return `${paper.title} ${paper.summary ?? ''} ${paper.sector ?? ''}`.toLowerCase().includes(normalizedQuery);
  });

  async function loadPapers() {
    setLoading(true);
    try {
      const response = await fetch('/api/research-papers', { cache: 'no-store' });
      const payload = await response.json() as { error?: string; papers?: Paper[]; canUpload?: boolean };
      if (!response.ok) throw new Error(payload.error || 'Unable to load research papers.');
      setPapers(payload.papers || []);
      setCanUpload(Boolean(payload.canUpload));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load research papers.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadPapers(); }, []);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file || !title.trim()) {
      setMessage('Add a title and choose a PDF or DOCX file.');
      return;
    }
    setUploading(true);
    setMessage('');
    const body = new FormData();
    body.set('file', file);
    body.set('title', title.trim());
    body.set('sector', sector.trim());
    body.set('summary', summary.trim());
    body.set('publishedOn', publishedOn);
    try {
      const response = await fetch('/api/research-papers', { method: 'POST', body });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Upload failed.');
      setTitle(''); setSector(''); setSummary('');
      if (fileRef.current) fileRef.current.value = '';
      setMessage('Research paper published.');
      await loadPapers();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return <section className="panel papers-panel">
    <header className="papers-head">
      <div><span>RESEARCH LIBRARY · VERIFIED DOCUMENTS</span><h2>Research Papers</h2><p>Jarvis research, valuation notes, and deep dives—kept in one decision-ready archive.</p></div>
      <b>{papers.length} DOCUMENT{papers.length === 1 ? '' : 'S'}</b>
    </header>

    <div className="paper-filters">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') trackEvent('paper_search', { queryLength: query.trim().length }); }}
        placeholder="Search titles, summaries, themes..."
        aria-label="Search research papers"
      />
      <select value={sectorFilter} onChange={(event) => setSectorFilter(event.target.value)} aria-label="Filter by sector">
        {sectors.map((item) => <option key={item} value={item}>{item === 'ALL' ? 'ALL SECTORS' : item.toUpperCase()}</option>)}
      </select>
      <span>{filteredPapers.length} / {papers.length} PAPERS</span>
    </div>

    {canUpload && <form className="paper-upload" onSubmit={upload}>
      <div className="upload-title"><span>ADMIN PUBLISHER</span><strong>Upload a new paper</strong></div>
      <label>Title<input value={title} onChange={(event)=>setTitle(event.target.value)} maxLength={140} required /></label>
      <label>Sector / theme<input value={sector} onChange={(event)=>setSector(event.target.value)} maxLength={60} placeholder="e.g. Coal, Autos, Gold" /></label>
      <label>Published<input type="date" value={publishedOn} onChange={(event)=>setPublishedOn(event.target.value)} required /></label>
      <label className="upload-file">Document<input ref={fileRef} type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required /></label>
      <label className="upload-summary">Executive note<textarea value={summary} onChange={(event)=>setSummary(event.target.value)} maxLength={500} rows={3} placeholder="What should readers know before opening it?" /></label>
      <button disabled={uploading}>{uploading ? 'PUBLISHING…' : 'PUBLISH PAPER →'}</button>
    </form>}

    {message && <div className="paper-message">{message}</div>}
    {loading ? <div className="papers-empty">LOADING RESEARCH LIBRARY…</div> : papers.length === 0 ? <div className="papers-empty"><strong>No papers published yet.</strong><span>{canUpload ? 'Use the admin publisher above to add the first report.' : 'The research desk has not published a document yet.'}</span></div> : filteredPapers.length === 0 ? <div className="papers-empty"><strong>No papers match these filters.</strong><span>Clear the search or choose a different sector.</span></div> : <div className="paper-list">
      {filteredPapers.map((paper)=> <article key={paper.id}>
        <div className="paper-meta"><span>{paper.sector || 'GENERAL RESEARCH'}</span><time>{new Date(paper.published_on+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</time></div>
        <h3>{paper.title}</h3>
        {paper.summary && <p>{paper.summary}</p>}
        <footer><small>{paper.file_name} · {(paper.file_size/1024/1024).toFixed(1)} MB</small>{paper.signed_url ? <a href={paper.signed_url} target="_blank" rel="noreferrer">OPEN PAPER ↗</a> : <span>LINK UNAVAILABLE</span>}</footer>
      </article>)}
    </div>}

    <style jsx>{`
      .papers-panel{background:var(--panel,#fff);border:1px solid var(--line,#d9dee5);overflow:hidden}
      .papers-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding:22px 28px;border-bottom:1px solid var(--line,#d9dee5);background:linear-gradient(120deg,#071421,#0d2233);color:#fff}
      .papers-head span,.upload-title span{font:700 11px/1.4 monospace;letter-spacing:.11em;color:#45a5ff}
      .papers-head h2{font-size:27px;margin:7px 0 5px}.papers-head p{margin:0;max-width:880px;color:#aab8c7}.papers-head b{font:700 11px monospace;color:#aab8c7;white-space:nowrap}
      .paper-filters{display:flex;align-items:center;gap:10px;padding:14px 34px;border-bottom:1px solid var(--line,#d9dee5);background:rgba(35,103,167,.025);flex-wrap:wrap}.paper-filters input{max-width:360px;flex:1;min-width:200px;border:1px solid #b9c4cf;background:transparent;color:inherit;padding:9px 11px;font:500 13px/1.4 inherit;outline:none}.paper-filters input:focus{border-color:#2388dc;box-shadow:0 0 0 2px rgba(35,136,220,.12)}.paper-filters select{border:1px solid #b9c4cf;background:transparent;color:inherit;padding:9px 11px;font:700 10px monospace;letter-spacing:.05em}.paper-filters span{margin-left:auto;color:#6d7d90;font:700 10px monospace;letter-spacing:.06em}
      .paper-upload{display:grid;grid-template-columns:1.6fr 1fr .8fr;gap:14px;padding:24px 34px;border-bottom:1px solid var(--line,#d9dee5);background:rgba(35,103,167,.045)}
      .upload-title{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center}.upload-title strong{font-size:17px}
      label{display:grid;gap:7px;font:700 10px monospace;letter-spacing:.07em;text-transform:uppercase;color:#66778b}input,textarea{width:100%;box-sizing:border-box;border:1px solid #b9c4cf;background:transparent;color:inherit;padding:11px 12px;font:500 14px/1.4 inherit;outline:none}input:focus,textarea:focus{border-color:#2388dc;box-shadow:0 0 0 2px rgba(35,136,220,.12)}
      .upload-file,.upload-summary{grid-column:1/3}.upload-summary{grid-column:1/-1}.paper-upload button{justify-self:start;border:0;background:#233a54;color:#fff;padding:13px 20px;font:800 11px monospace;letter-spacing:.08em;cursor:pointer}.paper-upload button:disabled{opacity:.55}
      .paper-message{margin:18px 34px 0;padding:12px 14px;border-left:3px solid #2388dc;background:rgba(35,136,220,.08);font:600 12px monospace}
      .paper-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr));gap:1px;background:var(--line,#d9dee5)}.paper-list article{background:var(--panel,#fff);padding:22px 26px;min-height:154px;display:flex;flex-direction:column}.paper-meta{display:flex;justify-content:space-between;gap:12px;font:700 10px monospace;color:#6d7d90;letter-spacing:.06em}.paper-meta span{color:#2388dc}.paper-list h3{font-size:20px;line-height:1.18;margin:14px 0 8px}.paper-list p{max-width:880px;color:#66778b;line-height:1.55;margin:0 0 18px}.paper-list footer{display:flex;justify-content:space-between;gap:14px;align-items:end;margin-top:auto}.paper-list small{color:#8794a3}.paper-list a{font:800 11px monospace;color:#2388dc;text-decoration:none;white-space:nowrap}.papers-empty{display:grid;place-items:center;align-content:center;gap:8px;min-height:220px;color:#718093}.papers-empty strong{font-size:20px}.papers-empty span{font-size:13px}
      @media(max-width:780px){.papers-head{padding:20px}.papers-head b{display:none}.paper-filters{padding:14px 20px}.paper-filters span{margin-left:0}.paper-upload{grid-template-columns:1fr;padding:20px}.upload-file,.upload-summary{grid-column:auto}.paper-list{grid-template-columns:1fr}.paper-list article{padding:20px}}
    `}</style>
  </section>;
}
