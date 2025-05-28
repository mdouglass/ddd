import _ from 'lodash'
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { CalendarObject, fromICS, toICS } from './ics'
import { Content, GenerateContentParameters, GoogleGenAI } from '@google/genai'
import { hash } from 'node:crypto'
import { DateTime } from 'luxon'

const generateParameters: Pick<GenerateContentParameters, 'model' | 'config'> = {
  model: 'gemini-2.5-flash-preview-04-17',
  // model: 'gemini-2.5-pro-preview-05-06',
  config: {
    temperature: 0,
    topP: 0.1,
    systemInstruction: `
You are an expert in cleaning up and formatting descriptions of events for a trail running team.
The trail running team consists of multiple groups of various skill levels. 
The groups are Group 1, Group 2, Group 3 and Group 4. 
Sometimes groups are combined for a run, so you may see Group 2,3 or Group 2,3,4.
Level is a synonym for group.
Sometimes there is an intermediate group, such as Group 2.5 or Level 3.5.
The name of the team is KHraces Trail Team or DDD (Dirt Divas and Dudes).

The first line of the user's message will be an initial summary of the event. The second and remaining lines will be a description of the event.
You should reply in the following format:

Summary will one line of text providing a summary of the type of event
- Remove "KHraces Trail Team - " from the beginning of the summary
- If the entire team practices together at a specific real world location, specify Team Practice and the location
- Otherwise, provide a short description of the type of workout and the mileage 
  - common workout types are "Easy 8mi", "Hill Repeats 3x1mi", "Long 20mi", "Speed Legs 6mi", "Fast Finish 6mi"
- If there are extra non-running workouts, add that to the summary as "& Workouts"
- Use Title Case for the summary
- If there are workouts and runs, please list the run first, then the workouts

Description will be multiple lines of text describing the event
- Remove any (Arrival Time:)
- Remove any Location:
- If different groups receive different instructions, preferentially provide only the instructions for group 3.5. If group 3.5 does not exist, provide the instructions for group 3.
`,
  },
}

const initialContents: Content[] = [
  {
    role: 'user',
    parts: [
      {
        text: `KHraces Trail Team - Team Practice - still casual miles\nLocation: Fullerton Loop\n This is a very casual team meet up. It will be a 10 mile loop out and back. Those wanting more miles can repeat it and those wanting less can turn around early.  (Arrival Time:  6:30 AM (Pacific Time (US & Canada)))`,
      },
    ],
  },
  {
    role: 'model',
    parts: [
      {
        text: `Team Practice - Fullerton Loop\nThis is a very casual team meet up. It will be a 10 mile loop out and back. Those wanting more miles can repeat it and those wanting less can turn around early.`,
      },
    ],
  },
  {
    role: 'user',
    parts: [
      {
        text: `KHraces Trail Team - Hills- You missed these! See Notes.\nGroup 1: Find a steep hill about a 1/4 mile long (it can be a little longer than that). It can be road or trail. Run up to the top running every step without stopping. This is NOT a sprint. Just try and run every step, and repeat this three more times. Each time you run down push the pace a tiny bit.\n\nGroup 2: Find a steep hill about a 1/2 mile long. It can be road or trail. Run up to the top running every step without stopping. This is NOT a sprint. Just try and run every step, and repeat this four more times. Each time you run down push the pace a tiny bit.\n\nGroup 2.5 & 3: Find a steep hill about a mile long (it can be a little longer than that). Road or trail. Run up to the top running every step without stopping. This is NOT a sprint. Just try and run every step, and repeat this three more times. Each time you run down push the pace a tiny bit.\n\nGroup 4: Find a steep hill about a mile long (it can be a little longer than that). Run up to the top running every step without stopping. This is NOT a sprint. Just try and run every step, and repeat this four more times. Each time you run down push the pace a tiny bit.  (Arrival Time: 12:00 PM (Pacific Time (US & Canada))) `,
      },
    ],
  },
  {
    role: 'model',
    parts: [
      {
        text: `Hills Repeats 4x1mi\nFind a steep hill about a mile long (it can be a little longer than that). Road or trail. Run up to the top running every step without stopping. This is NOT a sprint. Just try and run every step, and repeat this three more times. Each time you run down push the pace a tiny bit.`,
      },
    ],
  },
  {
    role: 'user',
    parts: [
      {
        text: `KHraces Trail Team - SEE NOTES\nPlease do this core workout & at home workout plus runs below\nWorkouts:\n1.https://www.youtube.com/watch?v=Auo8veVyRIY&t=10s\n2. https://www.youtube.com/watch?v=ysKkAA9jK0Q&list=WL&index=19&t=25s\n\nRuns:\nGroup 1: 5 miles w/the last mile pushing the pace as hard as you can\nGroup 2 and 2.5: 7 miles w/the last mile pushing the pace as hard as you can\nGroup 3: 9 miles w/the last mile pushing the pace as hard as you can\nGroup 4: 9 miles w/the last mile pushing the pace as hard as you can  (Arrival Time: 12:00 PM (Pacific Time (US & Canada)))`,
      },
    ],
  },
  {
    role: 'model',
    parts: [
      {
        text: `Fast Finish 9mi + Workouts\n9 miles w/the last mile pushing the pace as hard as you can\n\nWorkouts:\n1. https://www.youtube.com/watch?v=Auo8veVyRIY&t=10s\n2. https://www.youtube.com/watch?v=ysKkAA9jK0Q&list=WL&index=19&t=25s`,
      },
    ],
  },
  {
    role: 'user',
    parts: [
      { text: `KHraces Trail Team - Rest\n(Arrival Time: 12:00 PM (Pacific Time (US & Canada)))` },
    ],
  },
  { role: 'model', parts: [{ text: `Rest\nRest` }] },
]

export function toMinimalEvent(event: CalendarObject): CalendarObject {
  return {
    type: 'VEVENT',
    properties: _.pickBy(
      event.properties,
      (_value, key) =>
        key.startsWith('DTSTART') ||
        key.startsWith('DTEND') ||
        key === 'SUMMARY' ||
        key === 'DESCRIPTION' ||
        key === 'LOCATION',
    ),
  }
}

export function hashKey(event: CalendarObject): string {
  const minimalEvent = toMinimalEvent(event)
  const minimalEventText = toICS(minimalEvent)
  return hash('sha256', minimalEventText, 'base64')
}

export async function hasStandardEvent(
  env: Env,
  hashKey: string,
): Promise<CalendarObject | undefined> {
  const event = await env.STANDARD_EVENTS.get(hashKey)
  return event ? fromICS(event, 'VEVENT') : undefined
}

export async function hasStandardEvents(
  env: Env,
  hashKeys: string[],
): Promise<(CalendarObject | undefined)[]> {
  if (hashKeys.length > 100) {
    return [
      ...(await hasStandardEvents(env, hashKeys.slice(0, 100))),
      ...(await hasStandardEvents(env, hashKeys.slice(100))),
    ]
  }

  const events = await env.STANDARD_EVENTS.get(hashKeys)
  return hashKeys.map((hk) => {
    const event = events.get(hk)
    return event ? fromICS(event, 'VEVENT') : undefined
  })
}

export async function putStandardEvent(
  env: Env,
  hashKey: string,
  event: CalendarObject,
): Promise<void> {
  const eventText = toICS(event)
  console.log({ event, eventText })
  await env.STANDARD_EVENTS.put(hashKey, eventText)
}

export class CalendarWorkflow extends WorkflowEntrypoint<Env> {
  override async run(
    event: Readonly<WorkflowEvent<{ calendarText: string; isRetry: boolean }>>,
    step: WorkflowStep,
  ) {
    const calendar = await step.do('parse ICS', async () => {
      return fromICS(event.payload.calendarText)
    })

    const originalEvents = calendar.properties.VEVENT as CalendarObject[]
    const standardEvents: CalendarObject[] = []
    for (let i = 0; i < originalEvents.length; ++i) {
      standardEvents.push(
        await step.do(
          `standardize VEVENT #${i}`,
          {
            retries: { limit: 3, delay: '60 seconds', backoff: 'constant' },
            timeout: '60 seconds',
          },
          async () => {
            const originalEvent = originalEvents[i]
            const originalEventHashKey = hashKey(originalEvent)

            // check to see if we converted this event on a previous calendar
            const cachedStandardEvent = event.payload.isRetry
              ? undefined
              : await hasStandardEvent(this.env, originalEventHashKey)
            if (cachedStandardEvent) {
              return cachedStandardEvent
            }

            // grab the event description
            const userText = ((originalEvent.properties.SUMMARY as string) +
              '\n' +
              originalEvent.properties.DESCRIPTION) as string
            console.log('User text:\n' + userText)

            // run it through the agent
            const ai = new GoogleGenAI({ apiKey: this.env.GEMINI_API_KEY })
            const { text: assistantText } = await ai.models.generateContent({
              ...generateParameters,
              contents: [...initialContents, { role: 'user', parts: [{ text: userText }] }],
            })
            console.log('Assistant text:\n' + assistantText)
            if (assistantText === undefined) {
              return originalEvent
            }

            const splitIndex = assistantText?.indexOf('\n')
            const summary = assistantText?.slice(0, splitIndex)
            const description = assistantText?.slice(splitIndex + 1)

            // combine into the final event
            const standardEvent: CalendarObject = {
              type: 'VEVENT',
              properties: {
                ...originalEvent.properties,
                SUMMARY: summary,
                DESCRIPTION: `${description}
                
Summary: ${originalEvent.properties.SUMMARY}
Description: ${originalEvent.properties.DESCRIPTION}`,
              },
            }

            // convert any event that starts at midnight to an all day events
            if (
              typeof standardEvent.properties.DTSTART === 'string' &&
              standardEvent.properties.DTSTART.endsWith('T000000')
            ) {
              const [date] = standardEvent.properties.DTSTART.split('T')
              standardEvent.properties.DTSTART = date
              delete standardEvent.properties.DTEND
            }

            // convert any event that starts/ends at the same time to a 1 or 4 hour event
            const DTSTART_LOCAL = 'DTSTART;TZID=America/Los_Angeles'
            const DTEND_LOCAL = 'DTEND;TZID=America/Los_Angeles'
            const ICS_DATE_FORMAT = `yyyyMMdd'T'HHmmss`
            if (
              typeof standardEvent.properties[DTSTART_LOCAL] === 'string' &&
              standardEvent.properties[DTSTART_LOCAL] === standardEvent.properties[DTEND_LOCAL]
            ) {
              const [date, time] = standardEvent.properties[DTSTART_LOCAL].split('T')
              standardEvent.properties[DTEND_LOCAL] =
                DateTime.fromFormat(standardEvent.properties[DTSTART_LOCAL], ICS_DATE_FORMAT)
                  .plus({ hours: standardEvent.properties.LOCATION === 'Zoom' ? 1 : 4 })
                  .toFormat(ICS_DATE_FORMAT) ?? standardEvent.properties[DTSTART_LOCAL]
            }

            // cache this conversion
            await putStandardEvent(this.env, originalEventHashKey, standardEvent)

            return standardEvent
          },
        ),
      )
    }

    return toICS({
      type: 'VCALENDAR',
      properties: {
        NAME: 'DDD',
        PRODID: 'ddd/0.1.0', // take from package.json
        VEVENT: standardEvents,
      },
    })
  }
}
