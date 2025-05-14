import _ from 'lodash'
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { convert, convertAI, getOriginal } from './ddd'
import { CalendarObject, fromICS, toICS } from './ics'
import { GenerateContentParameters, GoogleGenAI } from '@google/genai'
import { CalendarWorkflow } from './calendar-workflow'

export default {
  fetch: async (request, env, ctx) => {
    const url = URL.parse(request.url)
    if (!url) {
      return new Response('Bad Request', { status: 400 })
    }

    const responseHeaders = {
      headers: {
        'content-type': url.searchParams.get('mime') === 'plain' ? 'text/plain' : 'text/calendar',
      },
    }

    switch (url.pathname) {
      case '/original.ics':
        return new Response(await getOriginal(env.DDD_ICS), responseHeaders)
      case '/group3.ics':
        return new Response(
          await convertAI(env, url, await getOriginal(env.DDD_ICS)),
          responseHeaders,
        )
      case '/group3-legacy.ics':
        return new Response(await convert(await getOriginal(env.DDD_ICS)), responseHeaders)
      default:
        return new Response('Not Found', { status: 404 })
    }
  },
} satisfies ExportedHandler<Env>

export { CalendarWorkflow } from './calendar-workflow'
