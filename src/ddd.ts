import { DateTime } from 'luxon'
import { CalendarObject, fold, fromICS, toICS, unfold } from './ics'
import { hash } from 'node:crypto'
import { hashKey, hasStandardEvents } from './calendar-workflow'

export async function getOriginal(url: string): Promise<string> {
  return (await fetch(url)).text()
}

export async function convert(calendar: string): Promise<string> {
  // transform the calendar to the way we want it
  const vcal = fromICS(calendar)
  vcal.properties.NAME = 'DDD'
  vcal.properties.PRODID = 'ddd/0.1.0' // take from package.json
  vcal.properties.VEVENT = (vcal.properties.VEVENT as CalendarObject[]).map((vevent) => {
    // convert any event that starts at midnight to an all day events
    if (
      typeof vevent.properties.DTSTART === 'string' &&
      vevent.properties.DTSTART.endsWith('T000000')
    ) {
      const [date] = vevent.properties.DTSTART.split('T')
      vevent.properties.DTSTART = date
      delete vevent.properties.DTEND
    }

    // convert any event that starts/ends at the same time to a 1 or 4 hour event
    const DTSTART_LOCAL = 'DTSTART;TZID=America/Los_Angeles'
    const DTEND_LOCAL = 'DTEND;TZID=America/Los_Angeles'
    const ICS_DATE_FORMAT = `yyyyMMdd'T'HHmmss`
    if (
      typeof vevent.properties[DTSTART_LOCAL] === 'string' &&
      vevent.properties[DTSTART_LOCAL] === vevent.properties[DTEND_LOCAL]
    ) {
      const [date, time] = vevent.properties[DTSTART_LOCAL].split('T')
      vevent.properties[DTEND_LOCAL] =
        DateTime.fromFormat(vevent.properties[DTSTART_LOCAL], ICS_DATE_FORMAT)
          .plus({ hours: vevent.properties.LOCATION === 'Zoom' ? 1 : 4 })
          .toFormat(ICS_DATE_FORMAT) ?? vevent.properties[DTSTART_LOCAL]
    }

    // remove See Notes from SUMMARY
    if (typeof vevent.properties.SUMMARY === 'string') {
      // console.log('before: ' + vevent.properties.SUMMARY)
      const match = vevent.properties.SUMMARY.match(/^(.*?)\s*-?\s*see notes\.?$/i)
      if (match) {
        vevent.properties.SUMMARY = match[1]
      }
      // console.log('after:  ' + vevent.properties.SUMMARY)
    }

    // various fixes to the DESCRIPTION field
    if (typeof vevent.properties.DESCRIPTION === 'string') {
      // console.log('before: ' + unfold(vevent.properties.DESCRIPTION) + '#')
      let description = unfold(vevent.properties.DESCRIPTION)
        .replaceAll('Group  3', 'Group 3')
        .replaceAll(/ *Level (\d)/g, 'Group $1')
        .split('\n')
        .map((line) => line.trim())
        .filter(
          (line) =>
            line.startsWith('Group 3') ||
            line.startsWith('Group 2,3') ||
            line.startsWith('Group 2, and 3') ||
            line.startsWith('Group 2, 2.5, and 3') ||
            line.startsWith('Group 2.5 & 3') ||
            line.startsWith('Group 2.5, 3') ||
            line.startsWith('Group one do two repeats, group 2,2.5 & 3') ||
            !line.startsWith('Group'),
        )
        .join('\n')
        .replaceAll('\n\n\n', '\n')
        .trim()

      const match = description.match(/(.*?)\s*\(Arrival Time: .*\)$/s)
      if (match) {
        description = match[1]
      }

      vevent.properties.DESCRIPTION = fold(description)
      // console.log('after:  ' + vevent.properties.DESCRIPTION + '#')
    }
    return vevent
  })

  return toICS(vcal)
}

async function getOrCreateWorkflow<PARAMS>(
  workflow: Workflow<PARAMS>,
  options: WorkflowInstanceCreateOptions<PARAMS>,
): Promise<WorkflowInstance> {
  try {
    return await workflow.get(options.id ?? '')
  } catch (e) {
    return await workflow.create(options)
  }
}

export async function convertAI(env: Env, url: URL, calendarText: string): Promise<string> {
  const calendarHash = hash('sha256', calendarText, 'hex') + (url.searchParams.get('retry') ?? '')

  // do we have a completed and converted calendar
  const workflow = await getOrCreateWorkflow(env.CALENDAR_WORKFLOW, {
    id: calendarHash,
    params: { calendarText },
  })
  const status = await workflow.status()
  if (status.status === 'complete' && typeof status.output === 'string') {
    return status.output
  }

  // processing is ongoing, build the final calendar as best we can from already converted pieces
  const calendar = fromICS(calendarText)

  const originalEvents = calendar.properties.VEVENT as CalendarObject[]
  const originalEventHashKeys = originalEvents.map((oe) => hashKey(oe))
  const standardEvents = await hasStandardEvents(env, originalEventHashKeys)

  return toICS({
    type: 'VCALENDAR',
    properties: {
      NAME: 'DDD',
      PRODID: 'ddd/0.1.0', // take from package.json
      VEVENT: standardEvents.map((se, index) => se ?? originalEvents[index]),
    },
  })
}
