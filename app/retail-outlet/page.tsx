// import {consumeToken} from '@/helpers/token-bridge';
import { cookies } from "next/headers";

// interface PageProps {
//   searchParams: Promise<{
//     bridgeId?: string;
//   }>;
// }

export default async function Page() {
  // const cookieStore = await cookies();
  // const params = await searchParams;

  // Prioritas: Cookie -> Query String
  // const bridgeId = cookieStore.get('bridge-id')?.value ?? params.bridgeId;

  // console.log('bridgeIdx', bridgeId);

  // if (!bridgeId) {
  //   return <>Bridge ID tidak ditemukan</>;
  // }

  // const bridgeId = cookieStore.get('bridge-id')?.value ?? params.bridgeId;

  // const token = consumeToken(bridgeId) ?? cookieStore.get('token-ro')?.value;

  const token = await cookies()?.get("token-ro")?.value;

  if (!token) {
    return <>Token tidak ditemukan / expired</>;
  }

  return <>token: {token}</>;
}
