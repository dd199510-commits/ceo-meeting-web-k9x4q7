import { AlertCircle, Check, Mail, Plus, Send, Users } from 'lucide-react'
import {
  findPersonByName,
  getContactCandidates,
  replaceLastAttendeeName,
  resolveAttendeeRefs,
  splitAttendees,
} from '../../lib/contacts'

function getActiveAttendeeName(attendees) {
  const text = String(attendees || '')
  if (!text.trim() || /[\n,，、/；;]\s*$/.test(text)) return ''

  const matches = Array.from(text.matchAll(/[^\n,，、/；;]+/g))
  return matches[matches.length - 1]?.[0]?.trim() ?? ''
}

export function AttendeeResolver({
  attendees,
  contacts = [],
  onChangeAttendees,
  onAddContact,
  secretaryContactIds = [],
  onToggleSecretaries,
}) {
  const names = splitAttendees(attendees)
  const refs = resolveAttendeeRefs(attendees, contacts)
  const activeName = getActiveAttendeeName(attendees)
  const activeExactPerson = findPersonByName(activeName, contacts)
  const candidates = activeName && !activeExactPerson ? getContactCandidates(activeName, contacts) : []

  if (names.length === 0) {
    return (
      <div className="attendee-resolver attendee-resolver-empty">
        <Users size={14} />
        <span>输入姓名后会在这里显示联系人标签。</span>
      </div>
    )
  }

  return (
    <div className="attendee-resolver">
      {candidates.length > 0 ? (
        <div className="attendee-candidates" aria-label="联系人候选">
          {candidates.map((contact) => (
            <button
              key={contact.id}
              type="button"
              className="attendee-candidate-chip"
              onClick={() => onChangeAttendees?.(replaceLastAttendeeName(attendees, contact.name))}
            >
              {contact.name}
              {contact.email ? <em>{contact.email}</em> : <em>未填写邮箱</em>}
            </button>
          ))}
        </div>
      ) : null}

      <div className="attendee-token-row" aria-label="识别出的参会人">
        {refs.map((ref) => {
          const linked = ref.contactId && ref.emailSnapshot
          const missingEmail = ref.contactId && !ref.emailSnapshot
          const contact = ref.type === 'contact' ? contacts.find((item) => item.id === ref.contactId) : null
          const hasSecretaries = (contact?.secretaries ?? []).length > 0
          const secretarySelected = secretaryContactIds.includes(ref.contactId)
          const className = linked
            ? 'attendee-token attendee-token-linked'
            : missingEmail
              ? 'attendee-token attendee-token-missing'
              : 'attendee-token attendee-token-unlinked'

          return (
            <span key={`${ref.displayName}-${ref.contactId ?? 'new'}`} className={className}>
              {linked ? <Check size={13} /> : missingEmail ? <Mail size={13} /> : <AlertCircle size={13} />}
              <strong>{ref.displayName}</strong>
              <em>{linked ? ref.emailSnapshot : missingEmail ? '缺邮箱' : '未关联'}</em>
              {hasSecretaries && onToggleSecretaries ? (
                <button
                  type="button"
                  className={secretarySelected ? 'attendee-token-action attendee-token-action-active' : 'attendee-token-action'}
                  onClick={() => onToggleSecretaries(ref.contactId)}
                  aria-label={`${secretarySelected ? '取消' : '添加'}${ref.displayName}的秘书会邀`}
                  title={`${secretarySelected ? '取消' : '发送'}秘书会邀`}
                >
                  <Send size={12} />
                  秘书
                </button>
              ) : null}
              {!ref.contactId && onAddContact ? (
                <button type="button" onClick={() => onAddContact(ref.displayName)} aria-label={`添加 ${ref.displayName} 到通讯录`}>
                  <Plus size={12} />
                </button>
              ) : null}
            </span>
          )
        })}
      </div>
    </div>
  )
}
