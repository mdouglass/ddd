export interface CalendarObject {
  type: string
  properties: Record<string, string | CalendarObject[] | undefined>
  lastKey?: string
}

function splitLine(line: string): [string, string] {
  const index = line.indexOf(':')
  if (index === -1) throw new Error('Invalid line: ' + line)
  return [line.slice(0, index), line.slice(index + 1)]
}

export function fromICS(calendar: string, rootType = 'VCALENDAR'): CalendarObject {
  const stack: CalendarObject[] = [{ type: 'root', properties: {} }]

  for (const line of calendar.split(/\r\n|\n|\r/)) {
    if (line.startsWith(' ')) {
      if (stack.length === 0) throw new Error('Unexpected line continuation')
      const obj = stack[stack.length - 1]
      if (obj.lastKey === undefined) throw new Error('Unexpected line continuation')
      obj.properties[obj.lastKey] += '\r\n' + line
      continue
    } else if (line.length === 0) {
      continue
    }
    const [key, value] = splitLine(line)

    switch (key) {
      case 'BEGIN':
        stack.push({ type: value, properties: {} })
        break
      case 'END': {
        const obj = stack.pop()
        if (!obj) throw new Error('Unexpected END')

        if (stack.length === 0) throw new Error('Unbalanced BEGIN/END')

        const parent = stack[stack.length - 1]
        const collection = (parent.properties[obj.type] ??= [])
        if (!Array.isArray(collection)) {
          throw new Error('Parent cannot collect ' + obj.type)
        }
        collection.push(obj)

        for (const [key, value] of Object.entries(obj.properties)) {
          if (typeof value === 'string') {
            obj.properties[key] = unescape(unfold2(value))
          }
        }

        break
      }
      default: {
        if (stack.length === 0) throw new Error('Unexpected property')
        const obj = stack[stack.length - 1]
        obj.properties[key] = value
        obj.lastKey = key
        break
      }
    }
  }

  if (stack.length !== 1) {
    throw new Error('Unbalanced BEGIN/END')
  }

  const root = stack[0].properties[rootType]
  if (!root || !Array.isArray(root)) {
    throw new Error('Missing root type: ' + rootType)
  }
  if (root.length !== 1) {
    throw new Error(`Found ${root.length} ${rootType}, expected 1`)
  }
  return root[0]
}

export function toICS(calendar: CalendarObject): string {
  let str = 'BEGIN:' + calendar.type + '\r\n'
  const sortedProperties = Object.entries(calendar.properties).sort(([lhsKey], [rhsKey]) =>
    lhsKey.localeCompare(rhsKey),
  )
  for (const [key, value] of sortedProperties) {
    if (!Array.isArray(value) && typeof value === 'string') {
      str += key + ':' + fold2(escape(value), key.length + 1) + '\r\n'
    }
  }
  for (const [, value] of sortedProperties) {
    if (Array.isArray(value)) {
      for (const child of value) {
        str += toICS(child)
      }
    }
  }
  str += 'END:' + calendar.type + '\r\n'
  return str
}

export function unfold(str: string): string {
  return str
    .split(/\r\n\s/)
    .join('')
    .replaceAll('\\n', '\n')
    .replaceAll('\\,', ',')
}

export function fold(str: string): string {
  return (
    str
      .replaceAll(',', '\\,')
      .replaceAll('\n', '\\n')
      .match(/.{1,60}/g)
      ?.join('\r\n ') ?? ''
  )
}

export function toTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '') // Remove hyphens and colons
    .replace(/\.\d+Z$/, '') // Remove milliseconds and Z
}

export function fold2(str: string, firstLineUsed: number): string {
  // split str into equal lines of 72 characters
  // and add a \r\n before each line
  // except the first line which is 72 - firstLineUsed characters

  const lines: string[] = []
  let idx = 0
  let firstLineLen = 72 - firstLineUsed
  if (firstLineLen < 1) firstLineLen = 1
  lines.push(str.slice(idx, idx + firstLineLen))
  idx += firstLineLen
  while (idx < str.length) {
    lines.push(str.slice(idx, idx + 72))
    idx += 72
  }
  return lines.join('\r\n ')

}

export function unfold2(str: string): string {
  return str.split(/\r\n\s/).join('')
}

function escape(str: string): string {
  return str
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;')
}

export function unescape(str: string): string {
  return str.replaceAll(/\\[\\,;Nn]/g, (match) =>
    match[1] === 'n' || match[1] === 'N' ? '\n' : match[1],
  )
}
