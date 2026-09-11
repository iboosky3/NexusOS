import { redirect } from "next/navigation";

export default async function LegacyTaskStudio({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan } = await searchParams;
  redirect(plan && /^[a-f0-9]{32}$/.test(plan) ? `/orchestrate?plan=${plan}` : "/");
}
