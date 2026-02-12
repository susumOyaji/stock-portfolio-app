export async function onRequest(context) {
    const { searchParams } = new URL(context.request.url);
    const url = searchParams.get('url');

    if (!url) {
        return new Response('Missing url parameter', { status: 400 });
    }

    try {
        // Yahooなどへリクエストを送信。ブラウザに近いUser-Agentを設定してブロックを回避
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        });

        const body = await response.text();

        // CORSを許可するヘッダーを付けてレスポンスを返す
        return new Response(body, {
            headers: {
                'Content-Type': response.headers.get('Content-Type') || 'text/html; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
    } catch (error) {
        return new Response(`Error fetching data: ${error.message}`, { status: 500 });
    }
}
