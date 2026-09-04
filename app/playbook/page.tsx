import Link from "next/link";
import { vault } from "@/lib/vault";

export default function Playbook() {
  const v = vault();
  const folders = [...new Set(v.notes.map(n => n.folder))].sort();
  return <section className="view">
    <div className="view-head"><div><h2>PLAYBOOK</h2><p>Doctrine from the vault, published notes only (frontmatter <code>publish: true</code>). Rebuilt on every vault push.</p></div></div>
    <div className="grid g2e">
      <div className="panel"><h3>F1 Ingest</h3><p>Every day starts here. 09:00 sweep, 09:45 opening-range capture, 16:15 journal sync. Feature table (gap, rvol, score, OR levels) feeds Floor 2.</p><Link className="btn ghost" href="/floor/1">ENTER FLOOR</Link></div>
      <div className="panel"><h3>F2 Analyze</h3><p>score = |gap%| + OR RVOL. ≥ 2.0 to even be a candidate. Rank; only top 1 advances. Most days: nothing qualifies.</p><Link className="btn ghost" href="/floor/2">ENTER FLOOR</Link></div>
      <div className="panel hot"><h3>F3 Decide</h3><p>ORB15-long. Entry after close-confirmation. Stop = OR low. Target 1.5R. Size off 2% equity. Cooling-off after a loss.</p><Link className="btn orange" href="/floor/3">ENTER FLOOR</Link></div>
      <div className="panel gold"><h3>F4 Execute</h3><p>Dry run → --approve paper → live only with dual confirm. Journal from fills. Bracket or nothing.</p><Link className="btn gold" href="/floor/4">ENTER FLOOR</Link></div>
    </div>
    {v.notes.length === 0 ? <div className="panel"><p className="muted">No published notes in this build ({v.source}). Add <code>publish: true</code> to a note inside an allowlisted folder and push the vault.</p></div> : null}
    {folders.map(f => <div className="panel" key={f}><h3>{f}</h3>
      {v.notes.filter(n => n.folder === f).map(n => <div key={n.slug}><Link href={`/playbook/${n.slug}`}>{n.title}</Link> {n.date ? <span className="muted mono">{n.date}</span> : null}</div>)}
    </div>)}
  </section>;
}
