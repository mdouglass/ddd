import { DateTime } from 'luxon'
import { CalendarObject, fromICS, toICS } from './ics'

export async function convert(url: string): Promise<string> {
  const calendar = await (await fetch(url)).text()
  // return calendar // see original for testing

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

    return vevent
  })

  return toICS(vcal)
}
