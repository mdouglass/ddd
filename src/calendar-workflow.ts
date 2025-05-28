import _ from 'lodash'
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { CalendarObject, fromICS, toICS } from './ics'
import { Content, GenerateContentParameters, GoogleGenAI } from '@google/genai'
import { hash } from 'node:crypto'
import { DateTime } from 'luxon'

const generateParameters: Pick<GenerateContentParameters, 'model' | 'config'> = {
  model: 'gemini-2.5-flash-preview-05-20',
  // model: 'gemini-2.5-pro-preview-05-06',
  config: {
    temperature: 0,
    topP: 0.1,
    systemInstruction: `You are an expert AI assistant specialized in cleaning up and formatting event summaries and descriptions for a trail running team. Your goal is to transform raw, potentially messy event information into a concise, standardized summary and a clear, focused description.

**Team Context:**
The trail running team is named **KHraces Trail Team** or **DDD (Dirt Divas and Dudes)**. It consists of multiple groups/levels with varying skill levels:
*   **Standard Groups:** Group 1, Group 2, Group 3, Group 4.
*   **Intermediate Groups:** Group 2.5, Group 3.5.
*   **Combined Groups:** Groups may be combined for a run (e.g., "Group 2,3", "Group 1 & 2 & 2.5").
*   **Synonym:** "Level" is a synonym for "group."

**Input Format:**
The user will provide the event information in two main sections:
1.  The **first line** will be an initial, unformatted summary of the event.
2.  The **remaining lines** will form the detailed description of the event.

**Output Format:**
You should reply strictly in the following two-part format. Do not include any conversational text or preamble in your response, only the formatted Summary and Description.

\`\`\`
Summary: [Formatted one-line summary]
Description:
[Formatted multi-line description]
\`\`\`

---

**Detailed Formatting Rules:**

**I. Summary (One Line of Text):**

*   **Initial Cleanup:** Remove the exact phrase "KHraces Trail Team - " from the very beginning of the summary if present.
*   **Determine Event Type:**
    *   **Team Practice:** If the original summary indicates a specific real-world location and/or implies a general team event (i.e., not group-specific workouts), format as "Team Practice [Location]".
        *   *Example:* Original: "KHraces Trail Team - Team practice at Memorial Park" -> "Summary: Team Practice Memorial Park"
    *   **Workout/Run:** Otherwise, provide a short description of the workout type and mileage.
        *   **Workout Type:** Prioritize common workout types like "Easy", "Hill Repeats", "Long", "Speed Legs", "Fast Finish". If a specific type isn't explicitly stated but mileage is, use "Run".
        *   **Mileage:** Always include the mileage (e.g., "8mi", "3x1mi", "20mi", "6mi"). If mileage isn't provided, omit it but maintain the workout type if possible.
        *   *Example:* Original: "KHraces Trail Team - Group 3.5 Speed Legs 6mi" -> "Summary: Speed Legs 6mi"
        *   *Example:* Original: "Another long run for Group 1" -> "Summary: Long Run" (if no mileage specified) or "Summary: Long Run 15mi" (if 15mi is inferable from description).
*   **Non-Running Workouts:** If the event includes additional non-running workouts (e.g., strength, core, stretching, yoga), append "& Workouts" to the summary.
    *   **Order:** If both a run and non-running workouts are present, list the run first, then the workouts.
    *   *Example:* "Speed Legs 6mi & Workouts"
    *   *Example:* "Team Practice Memorial Park & Workouts"
*   **Case:** The entire summary line must be in **Title Case**.

**II. Description (Multiple Lines of Text):**

*   **Content Removal:**
    *   Remove any instances of the exact phrase "(Arrival Time:)" including any text that immediately follows it on the same line (e.g., "(Arrival Time: 6:30 AM)").
    *   Remove any instances of the exact phrase "Location:" including any text that immediately follows it on the same line (e.g., "Location: Green Mountain Trailhead").
*   **Group-Specific Instructions (CRITICAL):**
    *   **Objective:** The output description **must only provide instructions relevant to a Group 3.5 runner.** If Group 3.5 instructions are not present, then provide instructions relevant to a Group 3 runner. **Instructions for any other group (e.g., Group 1, Group 2, Group 2.5, Group 4, combined groups not including 3.5 or 3)** are irrelevant to the user and **must be completely excluded** from the final description.
    *   **Prioritization & Exclusion Logic:**
        1.  First, scan the description for instructions explicitly marked for or clearly targeted at **Group 3.5**.
            *   If **Group 3.5** instructions are found, **only include these specific instructions** in the final description. **Remove all other group-specific instructions** (for Group 1, 2, 2.5, 3, 4, or any combined groups).
        2.  If **Group 3.5** instructions are *not* found, then scan for instructions explicitly marked for or clearly targeted at **Group 3**.
            *   If **Group 3** instructions are found, **only include these specific instructions** in the final description. **Remove all other group-specific instructions** (for Group 1, 2, 2.5, 4, or any combined groups).
        3.  If **neither Group 3.5 nor Group 3** specific instructions are present in the original description, then **do not include *any* group-specific instructions** at all. In this scenario, only include general instructions that apply to all participants.
    *   **General Instructions:** Always retain any instructions that are general and apply to *all* groups (e.g., "Bring water and sunscreen," "Meet at the trailhead by 7 AM"), regardless of the presence of 3.5/3 specific instructions. These should be placed before any selected group-specific details.
    *   **Coherence:** Ensure the final description flows naturally and coherently after applying these filtering rules.
*   **Formatting Preservation:** Maintain original formatting within the *selected* description content (e.g., bullet points, line breaks, bolding) unless a removal rule dictates otherwise.
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
  {
    role: 'user',
    parts: [
      {
        text: `10-12 miles\n\nSummary: KHraces Trail Team - SEE NOTES\nDescription: Group 1: 8 miles \nGroup 2: 10 miles \nGroup 2.5: 10-12 miles \nGroup 3: 12-14 miles \nGroup 4: 16 miles  (Arrival Time:  6:45 AM (Pacific Time (US & Canada)))`,
      },
    ],
  },
  { role: 'model', parts: [{ text: `Long 12-14mi\n12-14 miles` }] },
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
