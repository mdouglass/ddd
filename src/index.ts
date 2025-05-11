import { conversation } from './conversation'
import { convert } from './ddd'

const fetch: ExportedHandlerFetchHandler<Env, unknown> = async (request, env, ctx) => {
  const url = URL.parse(request.url)
  if (!url) {
    return new Response('Bad Request', { status: 400 })
  }

  switch (url.pathname) {
    case '/calendar.ics':
      return new Response(await convert(env.DDD_ICS), {
        headers: {
          'content-type':
            URL.parse(request.url)?.searchParams.get('mime') === 'plain'
              ? 'text/plain'
              : 'text/calendar',
        },
      })
    case '/conversation.txt':
      return new Response(await conversation(env.DDD_ICS), {
        headers: { 'content-type': 'text/plain' },
      })

    default:
      return new Response('Not Found', { status: 404 })
  }
}

export default { fetch } satisfies ExportedHandler<Env>
