import { splitAttendees } from '../../lib/contacts'

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const EXACT_EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

import { DEFAULT_MEETING_PREFIX } from '../../data/meetingData'

function unique(values) {
  const seen = new Set()
  return values.filter((value) => {
    const key = String(value || '').trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function extractEmails(value) {
  return unique(String(value || '').match(EMAIL_PATTERN) ?? [])
}

function collectRefEmails(refs) {
  return unique(
    (Array.isArray(refs) ? refs : [])
      .map((ref) => String(ref.emailSnapshot || '').trim())
      .filter((email) => EXACT_EMAIL_PATTERN.test(email)),
  )
}

function collectRefPeople(attendees, refs) {
  const names = splitAttendees(attendees)
  const attendeeRefs = Array.isArray(refs) ? refs : []

  return attendeeRefs
    .map((ref, index) => {
      const email = String(ref.emailSnapshot || '').trim()
      if (!EXACT_EMAIL_PATTERN.test(email)) return null
      const name = String(ref.displayName || names[index] || email).trim()
      return {
        name: name || email,
        email,
        label: `${name || email}<${email}>`,
      }
    })
    .filter(Boolean)
}

function collectRawEmailPeople(value) {
  return extractEmails(value).map((email) => ({
    name: email,
    email,
    label: email,
  }))
}

function uniquePeople(people) {
  const seen = new Set()
  return people.filter((person) => {
    const key = String(person.email || '').trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function collectMissingNames(attendees, refs) {
  const names = splitAttendees(attendees)
  const attendeeRefs = Array.isArray(refs) ? refs : []

  return names.filter((name, index) => {
    const ref = attendeeRefs[index]
    if (!ref) return !extractEmails(name).length
    return !ref.emailSnapshot
  })
}

function buildRequiredEmails(sourceMeeting, scheduledMeeting) {
  const refEmails = collectRefEmails(sourceMeeting?.attendeeRefs)
  const rawEmails = extractEmails(`${sourceMeeting?.attendees || ''}\n${scheduledMeeting.attendees || ''}`)
  return unique([...refEmails, ...rawEmails])
}

function buildRequiredPeople(sourceMeeting, scheduledMeeting) {
  const refPeople = collectRefPeople(sourceMeeting?.attendees, sourceMeeting?.attendeeRefs)
  const rawPeople = collectRawEmailPeople(`${sourceMeeting?.attendees || ''}\n${scheduledMeeting.attendees || ''}`)
  return uniquePeople([...refPeople, ...rawPeople])
}

function buildOptionalEmails(sourceMeeting) {
  const refEmails = collectRefEmails(sourceMeeting?.extraInviteeRefs)
  const rawEmails = extractEmails(sourceMeeting?.extraInvitees)
  return unique([...refEmails, ...rawEmails])
}

function buildOptionalPeople(sourceMeeting) {
  const refPeople = collectRefPeople(sourceMeeting?.extraInvitees, sourceMeeting?.extraInviteeRefs)
  const rawPeople = collectRawEmailPeople(sourceMeeting?.extraInvitees)
  return uniquePeople([...refPeople, ...rawPeople])
}

function buildBody(sourceMeeting, scheduledMeeting) {
  const attendees = splitAttendees(sourceMeeting?.attendees || scheduledMeeting.attendees || '').join('、')
  return `参会人：${attendees}`
}

function buildMeetingSubject(sourceMeeting, scheduledMeeting) {
  const prefix = String(
    sourceMeeting?.meetingPrefix ?? scheduledMeeting?.meetingPrefix ?? DEFAULT_MEETING_PREFIX,
  ).trim()
  const name = String(
    sourceMeeting?.name ||
      scheduledMeeting?.name ||
      scheduledMeeting?.meetingName ||
      scheduledMeeting?.subject ||
      scheduledMeeting?.title ||
      scheduledMeeting?.taskId ||
      '未命名会议',
  ).trim()

  if (!prefix || name.startsWith(prefix)) return name
  return `${prefix}${name}`
}

export function buildOutlookInviteRows({ meetings = [], scheduledMeetings = [] }) {
  const meetingMap = new Map(meetings.map((meeting) => [meeting.id, meeting]))
  const meetingNameMap = new Map(
    meetings
      .filter((meeting) => meeting.name?.trim())
      .map((meeting) => [meeting.name.trim(), meeting]),
  )

  return scheduledMeetings
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime))
    .map((scheduledMeeting) => {
      const scheduledName = String(scheduledMeeting.name || scheduledMeeting.meetingName || '').trim()
      const sourceMeeting = scheduledMeeting.meetingId
        ? meetingMap.get(scheduledMeeting.meetingId) ?? meetingNameMap.get(scheduledName) ?? null
        : meetingNameMap.get(scheduledName) ?? null
      const requiredEmails = buildRequiredEmails(sourceMeeting, scheduledMeeting)
      const optionalEmails = buildOptionalEmails(sourceMeeting)
      const requiredPeople = buildRequiredPeople(sourceMeeting, scheduledMeeting)
      const optionalPeople = buildOptionalPeople(sourceMeeting)
      const missingRequired = collectMissingNames(
        sourceMeeting?.attendees || scheduledMeeting.attendees,
        sourceMeeting?.attendeeRefs,
      )
      const missingOptional = collectMissingNames(sourceMeeting?.extraInvitees, sourceMeeting?.extraInviteeRefs)

      return {
        id: scheduledMeeting.id,
        scheduledMeeting,
        sourceMeeting,
        subject: buildMeetingSubject(sourceMeeting, scheduledMeeting),
        date: scheduledMeeting.date,
        startTime: scheduledMeeting.startTime,
        endTime: scheduledMeeting.endTime,
        duration: scheduledMeeting.duration,
        requiredEmails,
        optionalEmails,
        requiredPeople,
        optionalPeople,
        missingRequired,
        missingOptional,
        location: sourceMeeting?.outlookLocation || '',
        body: buildBody(sourceMeeting, scheduledMeeting),
      }
    })
}

function escapeVba(value) {
  return String(value ?? '').replace(/"/g, '""')
}

function unicodeEscape(value) {
  return Array.from(String(value ?? '')).map((char) => {
    const code = char.charCodeAt(0)
    if (char === '\\' || code < 32 || code > 126) {
      return `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`
    }
    return char
  }).join('')
}

function encodeText(value) {
  return unicodeEscape(
    String(value ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replaceAll('<<BR>>', '< <BR> >')
      .replaceAll('\n', '<<BR>>'),
  )
}

function vbaLiteral(value) {
  const encoded = encodeText(value)
  if (!encoded) return '""'

  const chunks = []
  for (let index = 0; index < encoded.length; index += 700) {
    chunks.push(`"${escapeVba(encoded.slice(index, index + 700))}"`)
  }

  return chunks.join(' & _\n    ')
}

function dateTimeExpression(dateString, timeString) {
  const [year, month, day] = String(dateString || '').split('-').map(Number)
  const [hour, minute] = String(timeString || '00:00').split(':').map(Number)

  return `DateSerial(${year || 2000}, ${month || 1}, ${day || 1}) + TimeSerial(${hour || 0}, ${minute || 0}, 0)`
}

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')

  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function buildCreateMeetingLines(rows) {
  return rows.map((row, index) => {
    const meetingId = `${row.scheduledMeeting.meetingId || 'adhoc'}-${row.scheduledMeeting.id || index}`
    return [
      `  CreateOneMeeting olApp, senderAccount, _`,
      `    ${vbaLiteral(meetingId)}, _`,
      `    ${vbaLiteral(row.subject)}, _`,
      `    ${dateTimeExpression(row.date, row.startTime)}, _`,
      `    ${dateTimeExpression(row.date, row.endTime)}, _`,
      `    ${vbaLiteral(row.location || '')}, _`,
      `    ${vbaLiteral(row.body)}, _`,
      `    ${vbaLiteral(row.requiredEmails.join(';'))}, _`,
      `    ${vbaLiteral(row.optionalEmails.join(';'))}`,
      `  createdCount = createdCount + 1`,
    ].join('\n')
  })
}

function buildOutlookAutomationScript({ rows = [], taskName = '排程任务', senderEmail = '', scriptKind = 'vba' }) {
  const senderLiteral = vbaLiteral(senderEmail.trim())
  const createLines = buildCreateMeetingLines(rows)
  const isVbs = scriptKind === 'vbs'
  const declarationPrefix = 'Const '
  const explicitSection = isVbs ? '' : 'Option Explicit\n\n'
  const startCall = isVbs ? '' : 'Sub CreateMeetingDrafts()\n'
  const endCall = isVbs ? '' : '\nEnd Sub'

  return `' Generated by Meeting Manager ${scriptKind === 'vbs' ? 'one-click-vbs' : 'fixed-ascii'} export on ${new Date().toISOString()}
' Task: ${unicodeEscape(taskName)}
' Sender: ${unicodeEscape(senderEmail.trim() || 'Outlook default account')}
${explicitSection}${declarationPrefix}OL_APPOINTMENT_ITEM = 1
${declarationPrefix}OL_MEETING = 1
${declarationPrefix}OL_REQUIRED = 1
${declarationPrefix}OL_OPTIONAL = 2
${declarationPrefix}OL_BUSY = 2
${declarationPrefix}OL_TEXT = 1
${declarationPrefix}OL_FOLDER_CALENDAR = 9
${declarationPrefix}MEETING_MANAGER_SENDER_EMAIL = ${senderLiteral}

${startCall}  Dim olApp
  Dim senderAccount
  Dim createdCount

  If MsgBox("Create ${rows.length} Outlook meeting draft(s). This script only saves drafts and will not display or send them. Continue?", vbOKCancel + vbQuestion, "Meeting Manager") <> vbOK Then
    ${isVbs ? 'WScript.Quit' : 'Exit Sub'}
  End If

  On Error Resume Next
  Set olApp = GetOutlookApp()
  If Err.Number <> 0 Or olApp Is Nothing Then
    MsgBox "Failed to start Outlook: " & Err.Description, vbExclamation, "Meeting Manager"
    ${isVbs ? 'WScript.Quit' : 'Exit Sub'}
  End If
  On Error GoTo 0

  Set senderAccount = GetOutlookAccount(olApp, MEETING_MANAGER_SENDER_EMAIL)

  If MEETING_MANAGER_SENDER_EMAIL <> "" And senderAccount Is Nothing Then
    MsgBox "Sender account not found in Outlook: " & MEETING_MANAGER_SENDER_EMAIL, vbExclamation, "Meeting Manager"
    ${isVbs ? 'WScript.Quit' : 'Exit Sub'}
  End If

  On Error Resume Next

${createLines.join('\n\n')}

  If Err.Number <> 0 Then
    MsgBox "Failed to create meeting drafts: " & Err.Description, vbExclamation, "Meeting Manager"
    ${isVbs ? 'WScript.Quit' : 'Exit Sub'}
  End If

  On Error GoTo 0
  MsgBox "Created " & createdCount & " Outlook meeting draft(s). Please review them in Outlook Calendar before sending.", vbInformation, "Meeting Manager"${endCall}

Function GetOutlookApp()
  On Error Resume Next
  Set GetOutlookApp = GetObject(, "Outlook.Application")
  If GetOutlookApp Is Nothing Then
    Set GetOutlookApp = CreateObject("Outlook.Application")
  End If
  On Error GoTo 0
End Function

Function GetOutlookAccount(olApp, senderAddress)
  Dim account
  Dim normalizedSender
  Dim accountAddress
  Dim accountName

  normalizedSender = LCase(Trim(CStr(senderAddress)))
  If normalizedSender = "" Then
    Set GetOutlookAccount = Nothing
    Exit Function
  End If

  For Each account In olApp.Session.Accounts
    accountAddress = LCase(Trim(CStr(account.SmtpAddress)))
    accountName = LCase(Trim(CStr(account.DisplayName)))
    If accountAddress = normalizedSender Or accountName = normalizedSender Then
      Set GetOutlookAccount = account
      Exit Function
    End If
  Next

  Set GetOutlookAccount = Nothing
End Function

Sub CreateOneMeeting(olApp, senderAccount, externalId, subjectText, startAt, endAt, locationText, bodyText, requiredAttendees, optionalAttendees)
  Dim appt
  Dim address
  Dim recipient
  Dim propertyItem

  If senderAccount Is Nothing Then
    Set appt = olApp.CreateItem(OL_APPOINTMENT_ITEM)
  Else
    Set appt = senderAccount.DeliveryStore.GetDefaultFolder(OL_FOLDER_CALENDAR).Items.Add(OL_APPOINTMENT_ITEM)
  End If

  With appt
    .MeetingStatus = OL_MEETING
    If Not senderAccount Is Nothing Then
      Set .SendUsingAccount = senderAccount
    End If
    .Subject = DecodeText(subjectText)
    .Start = startAt
    .End = endAt
    .Location = DecodeText(locationText)
    .Body = DecodeText(bodyText)
    .BusyStatus = OL_BUSY
    .ReminderSet = True
    .ReminderMinutesBeforeStart = 15
    For Each address In Split(requiredAttendees, ";")
      If Trim(address) <> "" Then
        Set recipient = .Recipients.Add(Trim(address))
        recipient.Type = OL_REQUIRED
      End If
    Next

    For Each address In Split(optionalAttendees, ";")
      If Trim(address) <> "" Then
        Set recipient = .Recipients.Add(Trim(address))
        recipient.Type = OL_OPTIONAL
      End If
    Next

    .Recipients.ResolveAll
    Set propertyItem = .UserProperties.Add("MeetingManagerDraftId", OL_TEXT, True)
    propertyItem.Value = externalId
    .Save
  End With
End Sub

Function DecodeText(value)
  DecodeText = DecodeUnicodeEscapes(Replace(CStr(value), "<<BR>>", vbCrLf))
End Function

Function DecodeUnicodeEscapes(value)
  Dim text
  Dim result
  Dim index
  Dim hexCode

  text = CStr(value)
  result = ""
  index = 1

  Do While index <= Len(text)
    If Mid(text, index, 2) = "\\u" And index + 5 <= Len(text) Then
      hexCode = Mid(text, index + 2, 4)
      If IsHexCode(hexCode) Then
        result = result & ChrW(CLng("&H" & hexCode))
        index = index + 6
      Else
        result = result & Mid(text, index, 1)
        index = index + 1
      End If
    Else
      result = result & Mid(text, index, 1)
      index = index + 1
    End If
  Loop

  DecodeUnicodeEscapes = result
End Function

Function IsHexCode(value)
  Dim index
  Dim char

  If Len(value) <> 4 Then
    IsHexCode = False
    Exit Function
  End If

  For index = 1 To 4
    char = UCase(Mid(value, index, 1))
    If InStr("0123456789ABCDEF", char) = 0 Then
      IsHexCode = False
      Exit Function
    End If
  Next

  IsHexCode = True
End Function
`
}

export function buildOutlookVbaScript({ rows = [], taskName = '排程任务', senderEmail = '' }) {
  return buildOutlookAutomationScript({ rows, taskName, senderEmail, scriptKind: 'vba' })
}

export function buildOutlookVbsScript({ rows = [], taskName = '排程任务', senderEmail = '' }) {
  return buildOutlookAutomationScript({ rows, taskName, senderEmail, scriptKind: 'vbs' })
}

export function downloadOutlookVbaScript({ rows, taskName, senderEmail }) {
  const script = buildOutlookVbaScript({ rows, taskName, senderEmail })
  const blob = new Blob([script], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `outlook-meeting-drafts-fixed-ascii-${formatTimestamp()}.bas`
  link.click()
  URL.revokeObjectURL(url)
}

export function downloadOutlookVbsScript({ rows, taskName, senderEmail }) {
  const script = buildOutlookVbsScript({ rows, taskName, senderEmail })
  const blob = new Blob([script], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `outlook-meeting-drafts-one-click-${formatTimestamp()}.vbs`
  link.click()
  URL.revokeObjectURL(url)
}
