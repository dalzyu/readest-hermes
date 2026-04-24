import { NextRequest, NextResponse } from 'next/server';

const corsOptions = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

const isLocalOrigin = (origin: string) => {
  try {
    const parsedOrigin = new URL(origin);

    if (parsedOrigin.protocol === 'tauri:' && parsedOrigin.hostname === 'localhost') {
      return true;
    }

    if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
      return false;
    }

    return (
      parsedOrigin.hostname === 'localhost' ||
      parsedOrigin.hostname === '127.0.0.1' ||
      parsedOrigin.hostname.endsWith('.localhost')
    );
  } catch {
    return false;
  }
};

const getAllowedOrigin = (request: NextRequest) => {
  const origin = request.headers.get('origin') ?? '';
  if (!origin) {
    return '';
  }

  if (origin === request.nextUrl.origin) {
    return origin;
  }

  return isLocalOrigin(origin) ? origin : '';
};

export function middleware(request: NextRequest) {
  const allowedOrigin = getAllowedOrigin(request);

  if (request.method === 'OPTIONS') {
    const preflightHeaders = new Headers({
      ...corsOptions,
      ...(allowedOrigin && { 'Access-Control-Allow-Origin': allowedOrigin }),
    });

    return new NextResponse(null, {
      status: 200,
      headers: preflightHeaders,
    });
  }

  const response = NextResponse.next();

  if (allowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
  }

  Object.entries(corsOptions).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

export const config = {
  matcher: ['/api/:path*', '/api/stripe/:path*', '/api/metadata/:path*'],
};
