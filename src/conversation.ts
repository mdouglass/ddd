import { CalendarObject, fromICS, unfold } from './ics'

const systemPrompt = `
This is a list of events from the calendar of a trail running team. The trail running team
consists of multiple groups of various skill levels. The groups are Group 1, Group 2, Group 3
and Group 4. Sometimes groups are combined for a run, so you may see Group 2,3 or Group 2,3,4.
Level is a synonym for group.
Sometimes there is an intermediate group, such as Group 2.5 or Level 3.5.
The name of the team is DDD (Dirt Divas and Dudes)

The creator of the calendar was very inconsistent when providing the information.
You are an expert in cleaning up and formatting data and will correct and standardize the entries.
In response to an event, you should return only a code block with the corrected and standardized version of the event.

Entries are in the form of

Event:
  field-1: field-1-value
  field-2: field-2-value

Field names are taken from the iCalendar standard.
Field values are taken from the iCalendar standard with values unfolded so they fit on a single line.
If there are newlines in a field value, they are escaped as \n.

1. DTSTART and DTEND dates should be corrected as follows:
  - If the start and end dates are midnight, report the event as an all day event.
  - If the start and end dates are the same:
    - change the end date to 1 hour later if the location is Zoom
    - otherwise, change the end date to 4 hours later

2. SUMMARY should be corrected as follows:
  - Create a short (5 words or less) summary of the event including the type of workout and then the mileage for the user's group (e.g "Easy 14", "Hill Repeats 3x1mi")
  - If it is a team workout, specify merely that and the location.
  - Use Title Case for the summary

3. DESCRIPTION should be corrected as follows:
  - Remove any arrival time
  - The user is in group 3.5 if it exists. Otherwise the user is in group 3. Report only the information specific to that group. Remove any prefix that indicated the group from the final output.
  - Remove any copy or near copy of the LOCATION in the description.

===========
`

export async function conversation(url: string): Promise<string> {
  const calendar = await (await fetch(url)).text()

  let response = ''
  function writeLine(...args: unknown[]) {
    response += args.join(' ') + '\n'
  }

  writeLine(systemPrompt)

  const vcal = fromICS(calendar)
  ;(vcal.properties.VEVENT as CalendarObject[]).forEach((vevent) => {
    writeLine('Event:')
    for (const [key, value] of Object.entries(vevent.properties)) {
      if (['DTSTAMP', 'SEQUENCE', 'LAST-MODIFIED', 'UID'].includes(key)) {
        continue
      }
      if (typeof value === 'string') {
        writeLine(`  ${key}:`, unfold(value).replaceAll('\n', '\\n'))
      }
    }
    writeLine()
  })

  return response
}
