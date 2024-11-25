import { convert } from './ddd'

export interface Env {
  DDD_ICS: string
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    return new Response(await convert(env.DDD_ICS), {
      headers: { 'content-type': 'text/calendar' },
    })
  },
} satisfies ExportedHandler<Env>
