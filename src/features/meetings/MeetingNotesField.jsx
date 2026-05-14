import { useEffect, useMemo, useRef, useState } from 'react'
import { readStorage } from '../../lib/storage'

function getMentionQuery(value, caret) {
  const textBeforeCaret = value.slice(0, caret)
  const markerIndex = textBeforeCaret.lastIndexOf('@')
  if (markerIndex < 0) return null

  const query = textBeforeCaret.slice(markerIndex + 1)
  if (/\s/.test(query)) return null

  return {
    query,
    start: markerIndex,
    end: caret,
  }
}

function syncMentionsWithText(text, noteMentions) {
  if (!Array.isArray(noteMentions) || noteMentions.length === 0) return []

  return noteMentions
    .filter((mention) => mention?.meetingId && text.includes(`@${mention.label}`))
    .map((mention) => ({
      label: mention.label,
      meetingId: mention.meetingId,
    }))
}

function findMentionRange(text, noteMentions, caretStart, caretEnd = caretStart, key = '') {
  if (!Array.isArray(noteMentions) || noteMentions.length === 0) return null

  for (const mention of noteMentions) {
    const token = `@${mention.label}`
    let searchIndex = text.indexOf(token)

    while (searchIndex >= 0) {
      const tokenEnd = searchIndex + token.length
      const hasSelection = caretStart !== caretEnd
      const selectionFullyCoversMention =
        hasSelection && caretStart <= searchIndex && caretEnd >= tokenEnd
      const isBackspaceBoundary =
        !hasSelection && key === 'Backspace' && caretStart === tokenEnd
      const isDeleteBoundary =
        !hasSelection && key === 'Delete' && caretStart === searchIndex

      if (selectionFullyCoversMention || isBackspaceBoundary || isDeleteBoundary) {
        return {
          start: searchIndex,
          end: tokenEnd,
          mention,
        }
      }

      searchIndex = text.indexOf(token, searchIndex + token.length)
    }
  }

  return null
}

function renderHighlightedNotes(text, noteMentions) {
  if (!text) return null

  const mentions = Array.isArray(noteMentions)
    ? noteMentions
        .filter((mention) => mention?.label)
        .sort((left, right) => right.label.length - left.label.length)
    : []

  if (mentions.length === 0) return text

  const ranges = []

  mentions.forEach((mention) => {
    const token = `@${mention.label}`
    let searchIndex = text.indexOf(token)

    while (searchIndex >= 0) {
      const nextRange = { start: searchIndex, end: searchIndex + token.length, label: token }
      const overlaps = ranges.some(
        (range) => nextRange.start < range.end && nextRange.end > range.start,
      )
      if (!overlaps) {
        ranges.push(nextRange)
      }
      searchIndex = text.indexOf(token, searchIndex + token.length)
    }
  })

  if (ranges.length === 0) return text

  ranges.sort((left, right) => left.start - right.start)
  const nodes = []
  let cursor = 0

  ranges.forEach((range, index) => {
    if (cursor < range.start) {
      nodes.push(
        <span key={`text-${index}-${cursor}`}>{text.slice(cursor, range.start)}</span>,
      )
    }

    nodes.push(
      <span key={`mention-${range.start}-${range.end}`} className="notes-mention-inline">
        {text.slice(range.start, range.end)}
      </span>,
    )
    cursor = range.end
  })

  if (cursor < text.length) {
    nodes.push(<span key={`tail-${cursor}`}>{text.slice(cursor)}</span>)
  }

  return nodes
}

export function MeetingNotesField({
  value,
  noteMentions = [],
  meetings = [],
  rows = 3,
  placeholder = '输入备注信息，支持使用 @ 引用其他会议',
  onChange,
}) {
  const textareaRef = useRef(null)
  const closeTimerRef = useRef(null)
  const [menuState, setMenuState] = useState(null)
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  const storedMeetings = useMemo(() => readStorage().meetings ?? [], [])
  const meetingOptions = useMemo(
    () => {
      const mergedMeetings = [...meetings, ...storedMeetings]
      const seen = new Set()

      return mergedMeetings.filter((meeting) => {
        if (!meeting?.id || !meeting.name?.trim() || meeting.status === 'deleted' || seen.has(meeting.id)) {
          return false
        }

        seen.add(meeting.id)
        return true
      })
    },
    [meetings, storedMeetings],
  )
  const suggestions = useMemo(() => {
    if (!menuState) return []
    const normalizedQuery = menuState.query.trim().toLowerCase()
    const source = normalizedQuery
      ? meetingOptions.filter((meeting) => meeting.name.toLowerCase().includes(normalizedQuery))
      : meetingOptions
    return source.slice(0, 6)
  }, [meetingOptions, menuState])
  const activeMentions = useMemo(
    () => syncMentionsWithText(value || '', noteMentions),
    [noteMentions, value],
  )

  useEffect(() => {
    setHighlightedIndex(0)
  }, [menuState?.query])

  useEffect(
    () => () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    },
    [],
  )

  function emitChange(nextValue, nextMentions) {
    onChange({
      value: nextValue,
      noteMentions: nextMentions,
    })
  }

  function updateMenu(target, nextValue = target.value) {
    const caret = target.selectionStart ?? nextValue.length
    setMenuState(getMentionQuery(nextValue, caret))
  }

  function handleTextChange(event) {
    const nextValue = event.target.value
    const nextMentions = syncMentionsWithText(nextValue, noteMentions)
    emitChange(nextValue, nextMentions)
    updateMenu(event.target, nextValue)
  }

  function insertMention(meeting) {
    if (!textareaRef.current || !menuState) return

    const mentionText = `@${meeting.name}`
    const currentValue = value || ''
    const nextValue = `${currentValue.slice(0, menuState.start)}${mentionText} ${currentValue.slice(menuState.end)}`
    const dedupedMentions = syncMentionsWithText(currentValue, noteMentions).filter(
      (mention) => mention.meetingId !== meeting.id,
    )

    emitChange(nextValue, [...dedupedMentions, { label: meeting.name, meetingId: meeting.id }])
    setMenuState(null)

    window.requestAnimationFrame(() => {
      if (!textareaRef.current) return
      const nextCaret = menuState.start + mentionText.length + 1
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(nextCaret, nextCaret)
    })
  }

  function handleKeyDown(event) {
    const selectionStart = event.currentTarget.selectionStart ?? 0
    const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart

    if ((event.key === 'Backspace' || event.key === 'Delete') && value) {
      const mentionRange = findMentionRange(
        value,
        activeMentions,
        selectionStart,
        selectionEnd,
        event.key,
      )
      if (mentionRange) {
        event.preventDefault()
        const nextValue = `${value.slice(0, mentionRange.start)}${value.slice(mentionRange.end)}`
        const nextMentions = syncMentionsWithText(
          nextValue,
          activeMentions.filter((mention) => mention.meetingId !== mentionRange.mention.meetingId),
        )

        emitChange(nextValue, nextMentions)
        setMenuState(null)

        window.requestAnimationFrame(() => {
          if (!textareaRef.current) return
          const nextCaret = mentionRange.start
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(nextCaret, nextCaret)
        })
        return
      }
    }

    if (!menuState || suggestions.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((current) => (current + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((current) => (current - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      insertMention(suggestions[highlightedIndex] ?? suggestions[0])
    } else if (event.key === 'Escape') {
      setMenuState(null)
    }
  }

  return (
    <div className="notes-mention-field">
      <div className="notes-mention-overlay" aria-hidden="true">
        {value ? (
          <div className="notes-mention-overlay-text">
            {renderHighlightedNotes(value, activeMentions)}
          </div>
        ) : (
          <div className="notes-mention-overlay-placeholder">{placeholder}</div>
        )}
      </div>
      <textarea
        ref={textareaRef}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={handleTextChange}
        onKeyDown={handleKeyDown}
        onClick={(event) => updateMenu(event.target)}
        onKeyUp={(event) => updateMenu(event.target)}
        onBlur={() => {
          closeTimerRef.current = window.setTimeout(() => setMenuState(null), 120)
        }}
        onFocus={(event) => updateMenu(event.target)}
      />
      <div className="notes-mention-footer">
        <div className="notes-mention-hint">输入 <strong>@</strong> 可快速引用其他会议</div>
      </div>
      {menuState ? (
        <div className="notes-mention-menu">
          <div className="notes-mention-menu-title">
            {menuState.query ? `选择要引用的会议：${menuState.query}` : '选择要引用的会议'}
          </div>
          {suggestions.length > 0 ? (
            suggestions.map((meeting, index) => (
              <button
                key={meeting.id}
                type="button"
                className={
                  index === highlightedIndex
                    ? 'notes-mention-option notes-mention-option-active'
                    : 'notes-mention-option'
                }
                onMouseDown={(event) => {
                  event.preventDefault()
                  insertMention(meeting)
                }}
              >
                <strong>@{meeting.name}</strong>
                <span>
                  {meeting.frequency?.type === 'yearly'
                    ? '年会'
                    : meeting.frequency?.type === 'monthly'
                      ? '月会'
                      : meeting.frequency?.type === 'weekly'
                        ? '周会'
                        : '不定期'}
                </span>
              </button>
            ))
          ) : (
            <div className="notes-mention-empty">没有匹配到可引用的会议</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
