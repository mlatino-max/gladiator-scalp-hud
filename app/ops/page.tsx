import OpsConsole from "@/components/Ops";
import { vault } from "@/lib/vault";
export default function Page() {
  const v = vault();
  return <OpsConsole vault={{ generatedAt: v.generatedAt, notes: v.notes.length, tickets: v.tickets.length, skipped: v.skipped, source: v.source }} />;
}
