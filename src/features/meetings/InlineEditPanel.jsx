import { useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import {
  FREQUENCY_LABELS,
  MONTHS,
  WEEKDAYS,
  getMeetingFrequencyType,
  getMeetingInterval,
  groupMeetingHistory,
  updateMeetingFrequency,
} from '../../data/meetingData'
import { calculateNextOccurrence } from '../../lib/meetingFrequency'
import { MeetingNotesField } from './MeetingNotesField'
import { AttendeeResolver } from './AttendeeResolver'
import { appendAttendeeNames, removeAttendeeNames } from '../../lib/contacts'

export function InlineEditPanel({ meeting, meetings = [], contacts = [], onCancel, onSave, onAddContact, embedded = false }) {
  const [formData, setFormData] = useState(meeting)
  const [historyInput, setHistoryInput] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const frequencyType = getMeetingFrequencyType(formData)
  const nextOccurrence = calculateNextOccurrence(formData)
  const historyGroups = groupMeetingHistory(formData)

  function addHistoryDates() {
    const dates = historyInput
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item))

    if (dates.length === 0) return

    setFormData((current) => ({
      ...current,
      history: [...new Set([...(current.history ?? []), ...dates])].sort(),
    }))
    setHistoryInput('')
  }

  function toggleSecretaryInvite(contactId) {
    const contact = contacts.find((item) => item.id === contactId)
    const secretaryNames = (contact?.secretaries ?? []).map((item) => item.name).filter(Boolean)
    if (secretaryNames.length === 0) return

    setFormData((current) => {
      const selectedIds = current.secretaryInviteContactIds ?? []
      const selected = selectedIds.includes(contactId)

      return {
        ...current,
        secretaryInviteContactIds: selected
          ? selectedIds.filter((id) => id !== contactId)
          : [...selectedIds, contactId],
        extraInvitees: selected
          ? removeAttendeeNames(current.extraInvitees, secretaryNames)
          : appendAttendeeNames(current.extraInvitees, secretaryNames),
      }
    })
  }

  const selectedMonths = Array.isArray(formData.frequency?.monthSpec)
    ? formData.frequency.monthSpec
    : [formData.frequency?.monthSpec || 1]

  const content = (
    <>
      <div className="inline-edit-rows">
        <div className="inline-edit-layout">
          <div className="inline-edit-column inline-edit-column-main">
            <label className="field inline-field inline-field-prefix">
              <span>会议前缀</span>
              <input
                value={formData.meetingPrefix ?? ''}
                onChange={(event) => setFormData({ ...formData, meetingPrefix: event.target.value })}
                placeholder="可留空"
              />
            </label>
            <label className="field inline-field inline-field-name">
              <span>会议名称</span>
              <input
                value={formData.name}
                onChange={(event) => setFormData({ ...formData, name: event.target.value })}
              />
            </label>

            <div className="inline-edit-row inline-edit-row-notes">
              <label className="field inline-field">
                <span>参会人</span>
                <textarea
                  rows="2"
                  value={formData.attendees}
                  onChange={(event) => setFormData({ ...formData, attendees: event.target.value })}
                />
                <AttendeeResolver
                  attendees={formData.attendees}
                  contacts={contacts}
                  onChangeAttendees={(attendees) => setFormData((current) => ({ ...current, attendees }))}
                  onAddContact={onAddContact}
                  secretaryContactIds={formData.secretaryInviteContactIds ?? []}
                  onToggleSecretaries={toggleSecretaryInvite}
                />
              </label>
              <label className="field inline-field">
                <span>不参会但需发会邀人员</span>
                <textarea
                  rows="2"
                  value={formData.extraInvitees}
                  onChange={(event) => setFormData({ ...formData, extraInvitees: event.target.value })}
                />
                <AttendeeResolver
                  attendees={formData.extraInvitees}
                  contacts={contacts}
                  onChangeAttendees={(extraInvitees) => setFormData((current) => ({ ...current, extraInvitees }))}
                  onAddContact={onAddContact}
                />
              </label>
              <label className="field inline-field">
                <span>备注</span>
                <MeetingNotesField
                  value={formData.notes}
                  noteMentions={formData.noteMentions}
                  meetings={meetings}
                  currentMeetingId={formData.id}
                  rows={2}
                  onChange={({ value, noteMentions }) =>
                    setFormData((current) => ({
                      ...current,
                      notes: value,
                      noteMentions,
                    }))
                  }
                />
              </label>
            </div>
          </div>

          <div className="inline-edit-column inline-edit-column-rule">
            <div className="field rule-builder inline-rule-builder">
              <span>频率设置</span>
              <div className="rule-builder-shell">
                <div className="rule-builder-head">
                  <label className="field inline-mini-field rule-field-type">
                    <span>会议类型</span>
                    <select
                      value={frequencyType}
                      onChange={(event) =>
                        setFormData((current) => updateMeetingFrequency(current, { type: event.target.value }))
                      }
                    >
                      {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field inline-mini-field rule-field-duration">
                    <span>会议时长</span>
                    <input
                      type="number"
                      value={formData.duration}
                      onChange={(event) =>
                        setFormData({ ...formData, duration: Number(event.target.value) || 0 })
                      }
                    />
                  </label>

                  <div className="field inline-mini-field inline-field-readonly rule-field-next">
                    <span>下次会议</span>
                    <div className="inline-readonly-value">{nextOccurrence || '待定'}</div>
                  </div>
                </div>

                {frequencyType === 'weekly' ? (
                  <div className="rule-sentence">
                    <div className="rule-group">
                      <span>每</span>
                      <input
                        className="rule-number-input"
                        type="number"
                        min="1"
                        value={getMeetingInterval(formData)}
                        onChange={(event) =>
                          setFormData((current) =>
                            updateMeetingFrequency(current, { interval: Number(event.target.value) || 1 }),
                          )
                        }
                      />
                      <span>周</span>
                    </div>
                    <div className="rule-group">
                      <span>在</span>
                    </div>
                    <div className="option-chip-row option-chip-row-dense">
                      {WEEKDAYS.map((day) => (
                        <button
                          key={day.val}
                          type="button"
                          className={formData.frequency?.daySpec === day.val ? 'option-chip option-chip-active' : 'option-chip'}
                          onClick={() =>
                            setFormData((current) => updateMeetingFrequency(current, { daySpec: day.val }))
                          }
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                    <span>举行</span>
                  </div>
                ) : null}

                {frequencyType === 'monthly' ? (
                  <div className="rule-sentence">
                    <div className="rule-group">
                      <span>每</span>
                      <input
                        className="rule-number-input"
                        type="number"
                        min="1"
                        value={getMeetingInterval(formData)}
                        onChange={(event) =>
                          setFormData((current) =>
                            updateMeetingFrequency(current, { interval: Number(event.target.value) || 1 }),
                          )
                        }
                      />
                      <span>月</span>
                    </div>
                    <div className="rule-group">
                      <span>在当月</span>
                      <input
                        className="rule-number-input"
                        type="number"
                        min="1"
                        max="31"
                        value={formData.frequency?.daySpec ?? 1}
                        onChange={(event) =>
                          setFormData((current) =>
                            updateMeetingFrequency(current, { daySpec: Number(event.target.value) || 1 }),
                          )
                        }
                      />
                      <span>号举行</span>
                    </div>
                  </div>
                ) : null}

                {frequencyType === 'yearly' ? (
                  <div className="rule-builder-stack">
                    <div className="rule-sentence">
                      <div className="rule-group">
                        <span>每</span>
                        <input
                          className="rule-number-input"
                          type="number"
                          min="1"
                          value={getMeetingInterval(formData)}
                          onChange={(event) =>
                            setFormData((current) =>
                              updateMeetingFrequency(current, { interval: Number(event.target.value) || 1 }),
                            )
                          }
                        />
                        <span>年</span>
                      </div>
                      <div className="rule-group">
                        <span>在选定月份的</span>
                        <input
                          className="rule-number-input"
                          type="number"
                          min="1"
                          max="31"
                          value={formData.frequency?.daySpec ?? 1}
                          onChange={(event) =>
                            setFormData((current) =>
                              updateMeetingFrequency(current, { daySpec: Number(event.target.value) || 1 }),
                            )
                          }
                        />
                        <span>号举行</span>
                      </div>
                    </div>
                    <div className="field inline-flex-field">
                      <span>发生月份</span>
                      <div className="option-chip-row option-chip-row-wrap option-chip-row-dense">
                        {MONTHS.map((month) => {
                          const selected = selectedMonths.includes(month.val)
                          return (
                            <button
                              key={month.val}
                              type="button"
                              className={selected ? 'option-chip option-chip-active' : 'option-chip'}
                              onClick={() => {
                                const nextMonths = selected
                                  ? selectedMonths.filter((item) => item !== month.val)
                                  : [...selectedMonths, month.val].sort((a, b) => a - b)

                                setFormData((current) =>
                                  updateMeetingFrequency(current, {
                                    monthSpec: nextMonths.length > 0 ? nextMonths : [month.val],
                                  }),
                                )
                              }}
                            >
                              {month.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                ) : null}

                {frequencyType === 'adhoc' ? (
                  <div className="rule-helper-text">不定期会议不参与自动周期计算。</div>
                ) : null}

                {frequencyType !== 'adhoc' ? (
                  <div className="rule-helper-row inline-rule-helper-row">
                    <label className="field inline-mini-field">
                      <span>锚点日期</span>
                      <input
                        type="date"
                        value={formData.frequency?.anchorDate || ''}
                        onChange={(event) =>
                          setFormData((current) => updateMeetingFrequency(current, { anchorDate: event.target.value }))
                        }
                      />
                    </label>
                    <span className="rule-helper-text">锚点日期用于计算周期，不改变你选择的周几、几号或月份规则。</span>
                  </div>
                ) : null}

                {frequencyType !== 'adhoc' && formData.frequency?.daySpec >= 29 ? (
                  <div className="field warning-text inline-warning-row">
                    天数不足的月份会自动顺延到当月最后一天。
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="inline-history-block inline-history-block-compact">
          <button
            type="button"
            className="section-toggle inline-history-toggle"
            onClick={() => setShowHistory((current) => !current)}
          >
            <div className="inline-history-title">
              <strong>历史记录</strong>
              <span>{(formData.history ?? []).length} 条</span>
            </div>
            <ChevronDown
              size={16}
              className={showHistory ? 'section-toggle-icon section-toggle-icon-open' : 'section-toggle-icon'}
            />
          </button>
          {showHistory ? (
            <>
              <div className="inline-history-row inline-history-row-compact">
                <input
                  value={historyInput}
                  onChange={(event) => setHistoryInput(event.target.value)}
                  placeholder="2026-03-01, 2026-03-08"
                />
                <button className="ghost-button" onClick={addHistoryDates}>
                  添加
                </button>
              </div>
              <div className="inline-history-list inline-history-list-compact">
                {historyGroups.map((group) => (
                  <div key={group.key} className="history-group">
                    <div className="history-group-label">{group.label}</div>
                    <div className="history-group-items">
                      {group.items.map((item) => (
                        <div key={item.value} className="inline-history-item inline-history-item-compact">
                          <span>{item.label}</span>
                          <button
                            className="icon-button danger"
                            onClick={() =>
                              setFormData((current) => ({
                                ...current,
                                history: (current.history ?? []).filter((historyItem) => historyItem !== item.value),
                              }))
                            }
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="panel-actions">
        <button className="ghost-button" onClick={onCancel}>
          取消
        </button>
        <button className="primary-button" onClick={() => onSave(formData)}>
          保存
        </button>
      </div>
    </>
  )

  if (embedded) {
    return content
  }

  return (
    <div className="inline-edit-panel">
      {content}
    </div>
  )
}
