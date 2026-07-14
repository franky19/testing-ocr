// import {BASE_PATH} from '@/config/devconfig';
// import {saveToken} from '@/helpers/token-bridge';
// import {randomUUID} from 'crypto';
import {NextResponse} from 'next/server';
import {headers} from 'next/headers';

// const allowedOrigins = [
//   'http://127.0.0.1:5500',
//   'http://localhost:3000',
//   'http://localhost:5173',
//   'http://10.36.53.24:5501',
//   'http://192.168.100.169:3012',
// ];

// function getCorsHeaders(origin: string | null) {
//   if (!origin || !allowedOrigins.includes(origin)) {
//     return {};
//   }

//   console.log('CORS Origin:', origin);

//   return {
//     'Access-Control-Allow-Origin': origin,
//     'Access-Control-Allow-Credentials': 'true',
//     'Access-Control-Allow-Methods': 'POST, OPTIONS',
//     'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Id',
//     Vary: 'Origin',
//   };
// }

// export async function OPTIONS(req: NextRequest, response: NextResponse) {
//   const token = req.headers.get('authorization');
//   const bridgeId = randomUUID();

//   saveToken(bridgeId, token, response);
//   return new NextResponse(null, {
//     status: 204,
//     headers: getCorsHeaders(req.headers.get('origin')),
//   });
// }

// function setCorsHeaders(response) {
//   // 💡 UBAH DI SINI: Tentukan origin spesifik pendukung credentials
//   response.headers.set(
//     'Access-Control-Allow-Origin',
//     'http://192.168.100.169:5500',
//   );
//   response.headers.set('Access-Control-Allow-Credentials', 'true');
//   response.headers.set(
//     'Access-Control-Allow-Methods',
//     'GET, POST, PUT, DELETE, OPTIONS',
//   );
//   response.headers.set(
//     'Access-Control-Allow-Headers',
//     'Content-Type, Authorization',
//   );
//   return response;
// }

// 1. WAJIB: Handle Preflight Request (diperlukan browser sebelum mengirim header Authorization)
// export async function OPTIONS() {
//   const response = new NextResponse(null, {status: 204});
//   return setCorsHeaders(response);
// }

export async function POST() {
  // console.log('========== Incoming Request ==========');
  // console.log('Method:', request.method);
  // console.log('URL:', request.url);

  // console.log('========== Headers ==========');
  // const headers = Object.fromEntries(request.headers.entries());
  // console.table(headers);

  // let body: unknown = null;

  // try {
  //   // Gunakan clone() agar request asli tidak ikut terpakai
  //   body = await request.clone().json();
  //   console.log('========== Body ==========');
  //   console.dir(body, {depth: null});
  // } catch {
  //   console.log('========== Body ==========');
  //   console.log('No JSON body');
  // }

  // const origin = req.headers.get('origin');
  const headersList = headers();
  const token = headersList.get('authorization');

  // console.log('token', token);

  // const token = req.headers.get('authorization');

  if (!token) {
    return NextResponse.json(
      {message: 'Unauthorized'},
      {
        status: 401,
        // headers: getCorsHeaders(origin),
      },
    );
  }

  // const bridgeId = randomUUID();

  // console.log('bridgeId', bridgeId);

  // saveToken(bridgeId, token, response);

  const res = NextResponse.json(
    {
      success: true,
      data: {
        // url: `${req.nextUrl.origin}/${BASE_PATH}/retail-outlet`,
        token,
      },
    },
    {
      // headers: getCorsHeaders(origin),
    },
  );

  res.cookies.set('token-ro', token, {
    httpOnly: false,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 5,
  });

  return res;
}
