import { notFound } from "next/navigation";
import { Floor1, Floor2, Floor3, Floor4 } from "@/components/floors";

export default async function FloorPage({ params, searchParams }: { params: Promise<{ n: string }>; searchParams: Promise<{ sym?: string }> }) {
  const { n } = await params;
  const { sym } = await searchParams;
  if (n === "1") return <Floor1 />;
  if (n === "2") return <Floor2 />;
  if (n === "3") return <Floor3 initialSym={sym} />;
  if (n === "4") return <Floor4 />;
  notFound();
}
