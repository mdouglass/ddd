import { convert } from './ddd'

export default {
  fetch: async (request, env, ctx) => {
    const url = URL.parse(request.url)
    if (!url) {
      return new Response('Bad Request', { status: 400 })
    }

    const responseHeaders = {
      headers: {
        'content-type':
          URL.parse(request.url)?.searchParams.get('mime') === 'plain'
            ? 'text/plain'
            : 'text/calendar',
      },
    }

    switch (url.pathname) {
      case '/original.ics':
        return new Response(await (await fetch(env.DDD_ICS)).text(), responseHeaders)
      case '/group3-legacy.ics':
        return new Response(await convert(env.DDD_ICS), responseHeaders)
      default:
        return new Response('Not Found', { status: 404 })
    }
  },
} satisfies ExportedHandler<Env>
