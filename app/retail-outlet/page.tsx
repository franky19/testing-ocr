import { cookies } from "next/headers";
import { consumeToken } from "../../lib/token-bridge";

interface PageProps {
  searchParams: Promise<{
    bridgeId?: string;
  }>;
}

export default async function Page({ searchParams }: PageProps) {
  const cookieStore = await cookies();
  const params = await searchParams;

  // Prioritas: Cookie -> Query String
  const bridgeId = cookieStore.get("bridge-id")?.value ?? params.bridgeId;

  if (!bridgeId) {
    return <>Bridge ID tidak ditemukan</>;
  }

  // const bridgeId = cookieStore.get('bridge-id')?.value ?? params.bridgeId;

  const token = consumeToken(bridgeId) ?? cookieStore.get("token-ro")?.value;

  if (!token) {
    return <>Token tidak ditemukan / expired</>;
  }

  return <>token : {token}</>;
}
