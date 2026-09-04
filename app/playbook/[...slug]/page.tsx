import Link from "next/link";
import { notFound } from "next/navigation";
import { noteBySlug, renderMarkdown, vault } from "@/lib/vault";

export function generateStaticParams() { return vault().notes.map(n => ({ slug: n.slug.split("/") })); }

export default async function Note({ params }: { params: Promise<{ slug: string | string[] }> }) {
  const { slug } = await params;
  const s = Array.isArray(slug) ? slug.join("/") : slug;
  const n = noteBySlug(s);
  if (!n) notFound();
  return <section className="view">
    <div className="view-head"><div><h2>{n.title}</h2><p>{n.folder} {n.date ? "· " + n.date : ""} {n.tags.length ? "· " + n.tags.join(", ") : ""}</p></div><Link className="btn ghost" href="/playbook">← PLAYBOOK</Link></div>
    <div className="panel prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(n.body) }} />
  </section>;
}
