export function splitAttendees(attendees) {
  return String(attendees || '')
    .split(/\n|,|，|、|\/|；|;/)
    .map((item) => item.trim().replace(/^[^:：]{1,24}[:：]\s*/, '').trim())
    .filter(Boolean)
}

function parseAliasList(value) {
  return String(value || '')
    .split(/\n|,|，|、|；|;/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseSecretaryLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed) return null

  const emailMatch = trimmed.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  const email = emailMatch?.[0] ?? ''
  const name = email
    ? trimmed.replace(email, '').replace(/[<>()，,；;]/g, ' ').trim()
    : trimmed

  return {
    id: `sec-${crypto.randomUUID()}`,
    name: name || email,
    email,
  }
}

export function parseSecretaries(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => ({
        id: item.id || `sec-${crypto.randomUUID()}`,
        name: String(item.name || '').trim(),
        email: String(item.email || '').trim(),
      }))
      .filter((item) => item.name || item.email)
  }

  return String(value || '')
    .split(/\n/)
    .map(parseSecretaryLine)
    .filter(Boolean)
}

export function replaceLastAttendeeName(attendees, nextName) {
  const text = String(attendees || '')
  const normalizedName = String(nextName || '').trim()
  if (!normalizedName) return text

  const matches = Array.from(text.matchAll(/[^\n,，、/；;]+/g))
  if (matches.length === 0) return normalizedName

  const lastMatch = matches[matches.length - 1]
  const start = lastMatch.index
  const end = start + lastMatch[0].length
  const leadingSpace = lastMatch[0].match(/^\s*/)?.[0] ?? ''
  const trailingSpace = lastMatch[0].match(/\s*$/)?.[0] ?? ''

  return `${text.slice(0, start)}${leadingSpace}${normalizedName}${trailingSpace}${text.slice(end)}`
}

export function normalizeContact(contact) {
  return {
    id: contact.id || `c-${crypto.randomUUID()}`,
    name: String(contact.name || '').trim(),
    email: String(contact.email || '').trim(),
    aliases: Array.isArray(contact.aliases)
      ? contact.aliases.map((item) => String(item).trim()).filter(Boolean)
      : parseAliasList(contact.aliases),
    secretaries: parseSecretaries(contact.secretaries),
    department: String(contact.department || '').trim(),
    title: String(contact.title || '').trim(),
    notes: String(contact.notes || '').trim(),
    status: contact.status === 'archived' ? 'archived' : 'active',
  }
}

function normalizeMatchKey(value) {
  return String(value || '').trim().toLocaleLowerCase()
}

export function findContactByName(name, contacts) {
  const key = normalizeMatchKey(name)
  if (!key) return null

  return contacts.find((contact) => {
    if (contact.status === 'archived') return false
    if (normalizeMatchKey(contact.name) === key) return true
    return (contact.aliases ?? []).some((alias) => normalizeMatchKey(alias) === key)
  }) ?? null
}

export function findPersonByName(name, contacts) {
  const contact = findContactByName(name, contacts)
  if (contact) {
    return {
      id: contact.id,
      type: 'contact',
      contactId: contact.id,
      displayName: contact.name,
      email: contact.email,
      sourceName: contact.name,
    }
  }

  const key = normalizeMatchKey(name)
  if (!key) return null

  for (const contactItem of contacts) {
    if (contactItem.status === 'archived') continue
    const secretary = (contactItem.secretaries ?? []).find((item) => normalizeMatchKey(item.name) === key)
    if (secretary) {
      return {
        id: `${contactItem.id}:${secretary.id}`,
        type: 'secretary',
        contactId: contactItem.id,
        secretaryId: secretary.id,
        displayName: secretary.name,
        email: secretary.email,
        sourceName: `${contactItem.name}秘书`,
      }
    }
  }

  return null
}

export function getContactCandidates(name, contacts, limit = 3) {
  const key = normalizeMatchKey(name)
  if (!key) return []

  const activeContacts = contacts.filter((contact) => contact.status !== 'archived')
  const secretaryEntries = activeContacts.flatMap((contact) =>
    (contact.secretaries ?? []).map((secretary) => ({
      id: `${contact.id}:${secretary.id}`,
      name: secretary.name,
      email: secretary.email,
      aliases: [`${contact.name}秘书`],
    })),
  )
  const entries = [...activeContacts, ...secretaryEntries]
  const exact = entries.filter((contact) => {
    if (normalizeMatchKey(contact.name) === key) return true
    return (contact.aliases ?? []).some((alias) => normalizeMatchKey(alias) === key)
  })
  const fuzzy = entries.filter((contact) => {
    if (exact.includes(contact)) return false
    const names = [contact.name, ...(contact.aliases ?? [])].map(normalizeMatchKey)
    return names.some((candidate) => candidate.includes(key) || key.includes(candidate))
  })

  return [...exact, ...fuzzy].slice(0, limit)
}

export function resolveAttendeeRefs(attendees, contacts) {
  return splitAttendees(attendees).map((displayName) => {
    const person = findPersonByName(displayName, contacts)

    return {
      contactId: person?.contactId ?? null,
      secretaryId: person?.secretaryId ?? null,
      type: person?.type ?? 'unlinked',
      displayName,
      emailSnapshot: person?.email ?? '',
      status: person ? (person.email ? 'linked' : 'missing-email') : 'unlinked',
    }
  })
}

export function appendAttendeeNames(attendees, names) {
  const currentNames = splitAttendees(attendees)
  const existingKeys = new Set(currentNames.map(normalizeMatchKey))
  const nextNames = names
    .map((name) => String(name || '').trim())
    .filter(Boolean)
    .filter((name) => {
      const key = normalizeMatchKey(name)
      if (existingKeys.has(key)) return false
      existingKeys.add(key)
      return true
    })

  return [...currentNames, ...nextNames].join('、')
}

export function removeAttendeeNames(attendees, names) {
  const removeKeys = new Set(names.map(normalizeMatchKey))
  return splitAttendees(attendees)
    .filter((name) => !removeKeys.has(normalizeMatchKey(name)))
    .join('、')
}

export function getResolvedAttendeeStats(attendeeRefs) {
  const refs = Array.isArray(attendeeRefs) ? attendeeRefs : []
  const linked = refs.filter((ref) => ref.contactId && ref.emailSnapshot).length

  return {
    total: refs.length,
    linked,
    missing: refs.length - linked,
  }
}

export function getAttendeeSummary(attendees, maxCount = 3) {
  const names = splitAttendees(attendees)
  if (names.length === 0) return '未指定'
  const visible = names.slice(0, maxCount).join('、')
  return names.length > maxCount ? `${visible}…` : visible
}
