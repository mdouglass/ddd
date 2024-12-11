import { convert } from './ddd'

export interface Env {
  DDD_ICS: string
}

const fetch: ExportedHandlerFetchHandler<Env, unknown> = async (request, env, ctx) => {
  console.log(request.url)
  console.dir(URL.parse(request.url))
  return new Response(await convert(env.DDD_ICS), {
    headers: {
      'content-type':
        URL.parse(request.url)?.searchParams.get('mime') === 'plain'
          ? 'text/plain'
          : 'text/calendar',
    },
  })
}

export default { fetch } satisfies ExportedHandler<Env>
