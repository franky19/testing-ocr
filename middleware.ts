import {NextRequest, NextResponse} from 'next/server';

export function middleware(req: NextRequest) {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    const headers = new Headers();

    if (origin) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Credentials', 'true');
      headers.set('Vary', 'Origin');
    }

    headers.set(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    );

    headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-token-ro',
    );

    return new NextResponse(null, {
      status: 204,
      headers,
    });
  }

  const requestHeaders = new Headers(req.headers);

  const authorization = req.headers.get('authorization');
  if (authorization) {
    requestHeaders.set('x-token-ro', authorization);
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Vary', 'Origin');
  }

  response.headers.set(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  );

  response.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, x-token-ro',
  );

  return response;
}
