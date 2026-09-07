import Link from "next/link";
import { notFound } from "next/navigation";
import { noteBySlug, renderMarkdown } from "@/lib/vault";

/* rendered per request: the Docker stack regenerates the index while the
   server runs, so build-time params would go stale */
export const dynamic = "force-dynamic";

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
