import Link from "next/link";
import { dailyNote, renderMarkdown, ticketsFor } from "@/lib/vault";
import DayFills from "@/components/DayFills";

export default async function Day({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const note = dailyNote(date);
  const tickets = ticketsFor(date);
  return <section className="view">
    <div className="view-head"><div><h2>JOURNAL // {date}</h2><p>Published daily note beside that day&apos;s fills, ticket, regime and verdict.</p></div><Link className="btn ghost" href="/evidence/trades">← TRADES</Link></div>
    <div className="grid g2e">
      <div>
        <DayFills date={date} />
      </div>
      <div>
        <div className="panel"><h3>DAILY NOTE</h3>{note ? <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.body) }} /> : <p className="muted">no published note for {date}</p>}</div>
        <div className="panel"><h3>TICKETS</h3>{tickets.length ? tickets.map(t => <div key={t.path} className="code">{JSON.stringify(t.ticket, null, 2)}</div>) : <p className="muted">no ticket file for {date} in the vault index</p>}</div>
      </div>
    </div>
  </section>;
}
