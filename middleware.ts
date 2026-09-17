import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const url = request.nextUrl;

  // Jika ada yang mencoba mengakses folder /js/ atau file .js
  if (url.pathname.startsWith('/js/') || url.pathname.endsWith('.js')) {
    // Alihkan paksa ke halaman utama (xxx.html) atau blokir dengan 404
    // url.pathname = '/xxx.html';
    // return NextResponse.rewrite(url);
    
    // Atau jika ingin langsung ditolak mentah-mentah (404 Not Found):
    return new NextResponse('Not Found', { status: 404 });
  }

  return NextResponse.next();
}

// Konfigurasi jalur yang ingin dicegat oleh middleware
export const config = {
  matcher: '/:path*',
};
