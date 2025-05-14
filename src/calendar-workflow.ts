import _ from 'lodash'
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { CalendarObject, fromICS, toICS, toTimestamp } from './ics'
import { GenerateContentParameters, GoogleGenAI } from '@google/genai'
import { hash } from 'node:crypto'

const generateParameters: Pick<GenerateContentParameters, 'model' | 'config'> = {
  model: 'gemini-2.5-flash-preview-04-17',
  // model: 'gemini-2.5-pro-preview-05-06',
  config: {
    temperature: 0,
    topP: 0.1,
    systemInstruction: `
This is a list of events from the calendar of a trail running team. The trail running team
consists of multiple groups of various skill levels. The groups are Group 1, Group 2, Group 3
and Group 4. Sometimes groups are combined for a run, so you may see Group 2,3 or Group 2,3,4.
Level is a synonym for group.
Sometimes there is an intermediate group, such as Group 2.5 or Level 3.5.
The name of the team is DDD (Dirt Divas and Dudes)

The creator of the calendar was very inconsistent when providing the information.
You are an expert in cleaning up and formatting data and will correct and standardize the entries.

The user will send you a VEVENT in iCalendar format (RFC 5545).
You should reply with a VEVENT in iCalendar format (RFC 5545).
- Start with BEGIN:VEVENT and ending with END:VEVENT
- Follow all rules of RFC 5545 as strictly as possible (including SHOULD and MUST)
- Format each field as a single line of text, using \n to indicate line breaks.
- Do not fold lines in your reply (ignore the line length limit)
- Do not use a code block or any other formatting

Make the following corrections:

1. DTSTART and DTEND dates should be corrected as follows:
  - If the start and end dates are midnight, report the event as an all day event (DTSTART contains only a date and DTEND is not set).
  - If the start and end dates are the same:
    - change the end date to 1 hour later if the location is Zoom
    - otherwise, change the end date to 4 hours later

2. SUMMARY should be corrected as follows:
  - If the entire team practices together at a specific real world location, specify Team Practice and the location
  - Otherwise, provide a short description of the type of workout and the mileage 
    - common workout types are "Easy 8mi", "Hill Repeats 3x1mi", "Long 20mi", "Speed Legs 6mi", "Fast Finish 6mi"
  - If there are extra non-running workouts, add that to the summary as "& Workouts"
  - Use Title Case for the summary

3. DESCRIPTION should be corrected as follows:
  - Remove any arrival time
  - The user is in group 3.5 if it exists. Otherwise the user is in group 3. Report only the information specific to that group. Remove any prefix that indicated the group from the final output.
  - Remove any copy or near copy of the LOCATION in the description.

4. LOCATION should not be corrected.
`,
  },
}

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
      ...await hasStandardEvents(env, hashKeys.slice(0, 100)),
      ...await hasStandardEvents(env, hashKeys.slice(100))
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
  await env.STANDARD_EVENTS.put(hashKey, eventText)
}

export class CalendarWorkflow extends WorkflowEntrypoint<Env> {
  override async run(event: Readonly<WorkflowEvent<{ calendarText: string }>>, step: WorkflowStep) {
    const calendar = await step.do('parse ICS', async () => {
      return fromICS(event.payload.calendarText)
    })

    const originalEvents = calendar.properties.VEVENT as CalendarObject[]
    const standardEvents: CalendarObject[] = []
    for (let i = 0; i < originalEvents.length; ++i) {
      standardEvents.push(
        await step.do(
          `standardize VEVENT #${i}`,
          { retries: { limit: 3, delay: '60 seconds', backoff: 'linear' }, timeout: '60 seconds' },
          async () => {
            const originalEvent = originalEvents[i]
            const originalEventHashKey = hashKey(originalEvent)

            // check to see if we converted this event on a previous calendar
            const cachedStandardEvent = await hasStandardEvent(this.env, originalEventHashKey)
            if (cachedStandardEvent) {
              return cachedStandardEvent
            }

            // create a minimal event that we can send to the agent
            const minimalEvent = toMinimalEvent(originalEvent)
            const minimalEventText = toICS(minimalEvent)
            console.log('User request:\n' + minimalEventText)

            // run it through the agent
            const ai = new GoogleGenAI({ apiKey: this.env.GEMINI_API_KEY })
            const { text: standardEventText } = await ai.models.generateContent({
              ...generateParameters,
              contents: [{ role: 'user', parts: [{ text: minimalEventText }] }],
            })
            console.log('AI response:\n' + standardEventText)

            // combine into the final event
            const standardEvent: CalendarObject = {
              type: 'VEVENT',
              properties: {
                ...originalEvent.properties,
                ...fromICS(standardEventText ?? '', 'VEVENT').properties,
                LOCATION: originalEvent.properties.LOCATION, // ignore AI's version of LOCATION?
                'LAST-MODIFIED': toTimestamp(new Date()),
              },
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
