import { useState } from 'react'
import { ChevronDown, FileText, Trash2 } from 'lucide-react'
import { getMeetingFrequencyType } from '../../data/meetingData'
import { calculateNextOccurrence, formatNextDateInfo } from '../../lib/meetingFrequency'
import { getAttendeeSummary } from '../../lib/contacts'
import { getCompactFrequencyLabel } from './meetingsUtils'

export function MeetingCard({
  meeting,
  onDelete,
  dragEnabled,
  dragHandle,
  onToggleInline,
  isEditing = false,
}) {
  const [showAllAttendees, setShowAllAttendees] = useState(false)
  const [showAllNotes, setShowAllNotes] = useState(false)
  const historyCount = meeting.history?.length ?? 0
  const latestHistory = historyCount > 0 ? meeting.history[historyCount - 1] : '无记录'
  const frequencyType = getMeetingFrequencyType(meeting)
  const nextOccurrence = calculateNextOccurrence(meeting)
  const nextDateInfo = formatNextDateInfo(nextOccurrence)
  const attendeeText = getAttendeeSummary(meeting.attendees, 4)
  const notesText = meeting.notes?.trim() || '暂无备注'
  const attendeesOverflow = attendeeText.length > 54
  const notesOverflow = notesText.length > 80

  return (
    <article className={`meeting-card meeting-card-${frequencyType}${isEditing ? ' meeting-card-editing' : ''}`}>
      <div className="meeting-header">
        <div className="meeting-card-title-row">
          {dragEnabled ? <div className="drag-handle">{dragHandle}</div> : null}
          <div className="meeting-title-block">
            <div className="meeting-title-main meeting-title-main-compact">
              <h3>{meeting.name}</h3>
              <span className={`meeting-frequency-badge meeting-frequency-badge-${frequencyType}`}>
                {getCompactFrequencyLabel(meeting)}
              </span>
              <span className="meeting-subtitle">
                {nextDateInfo.prefix ? `${nextDateInfo.prefix} ${nextDateInfo.date}` : nextDateInfo.date}
              </span>
            </div>
            <div className="meeting-time-meta">
              <div className="meeting-time-chip">
                <span className="meeting-time-chip-label">时长</span>
                <strong>{meeting.duration}m</strong>
              </div>
              <div className="meeting-time-chip">
                <span className="meeting-time-chip-label">历史</span>
                <strong>{historyCount} 次</strong>
              </div>
              <div className="meeting-time-chip">
                <span className="meeting-time-chip-label">最近</span>
                <strong>{latestHistory}</strong>
              </div>
            </div>
          </div>
        </div>
        <div className="meeting-actions">
          <button className={isEditing ? 'icon-button icon-button-active' : 'icon-button'} onClick={() => onToggleInline(meeting.id)}>
            <FileText size={16} />
          </button>
          <button className="icon-button danger" onClick={() => onDelete(meeting.id)}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div className="meeting-detail-grid">
        <div className="meeting-detail-card">
          <div className="meeting-detail-head">
            <p className="meeting-detail-label">参会人</p>
            {attendeesOverflow ? (
              <button
                type="button"
                className={showAllAttendees ? 'meeting-detail-toggle is-open' : 'meeting-detail-toggle'}
                onClick={() => setShowAllAttendees((current) => !current)}
              >
                <ChevronDown size={14} />
              </button>
            ) : null}
          </div>
          <p className={showAllAttendees ? 'meeting-detail-content meeting-detail-content-inline is-expanded' : 'meeting-detail-content meeting-detail-content-inline'}>
            {attendeeText}
          </p>
        </div>
        <div className="meeting-detail-card">
          <div className="meeting-detail-head">
            <p className="meeting-detail-label">备注</p>
            {notesOverflow ? (
              <button
                type="button"
                className={showAllNotes ? 'meeting-detail-toggle is-open' : 'meeting-detail-toggle'}
                onClick={() => setShowAllNotes((current) => !current)}
              >
                <ChevronDown size={14} />
              </button>
            ) : null}
          </div>
          <p className={showAllNotes ? 'meeting-detail-content meeting-detail-content-inline is-expanded' : 'meeting-detail-content meeting-detail-content-inline'}>
            {notesText}
          </p>
        </div>
      </div>
    </article>
  )
}
