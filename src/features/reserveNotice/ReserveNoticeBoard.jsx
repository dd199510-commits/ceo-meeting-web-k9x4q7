import { useMemo, useState } from 'react'
import { CheckCircle2, Copy, FilePlus2, PencilLine, Search, Trash2, X } from 'lucide-react'
import { FREQUENCY_LABELS } from '../../data/meetingData'
import { splitAttendees } from '../../lib/contacts'
import {
  BUILT_IN_NOTICE_TEMPLATE_KEYS,
  BUILT_IN_NOTICE_TEMPLATES,
  getMergedNoticeTemplates,
  getNoticeTemplateOptions,
  NOTICE_VARIABLE_OPTIONS,
  normalizeNoticeTemplates,
} from './notificationTemplates'

function weekdayLabel(dateString) {
  const date = new Date(dateString)
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
}

function formatDisplayDate(dateString) {
  const date = new Date(dateString)
  return `${date.getMonth() + 1}月${date.getDate()}日（${weekdayLabel(dateString)}）`
}

function formatDisplayTime(startTime, endTime) {
  return `${startTime} - ${endTime}`
}

function buildOccurrenceRangeLabel(occurrences) {
  if (!Array.isArray(occurrences) || occurrences.length === 0) return '暂无安排'
  if (occurrences.length === 1) {
    return `${formatDisplayDate(occurrences[0].date)} ${formatDisplayTime(occurrences[0].startTime, occurrences[0].endTime)}`
  }

  const first = occurrences[0]
  const last = occurrences[occurrences.length - 1]
  return `${formatDisplayDate(first.date)} 至 ${formatDisplayDate(last.date)}`
}

function summarizeText(value, fallback = '未填写') {
  if (!value) return fallback
  const normalized = String(value).replace(/\s+/g, ' ').trim()
  return normalized || fallback
}

function buildArrangementList(occurrences) {
  return occurrences
    .map((item) => `- ${formatDisplayDate(item.date)} ${formatDisplayTime(item.startTime, item.endTime)}`)
    .join('\n')
}

function resolveTemplateKey(meeting, scheduledMeeting, templates) {
  if (meeting?.notificationTemplateKey && templates[meeting.notificationTemplateKey]) {
    return meeting.notificationTemplateKey
  }

  const meetingName = meeting?.name ?? scheduledMeeting.name ?? ''
  if (/1-1/i.test(meetingName)) {
    return 'one_on_one_exec'
  }

  if (scheduledMeeting.frequency === 'monthly' || scheduledMeeting.frequency === 'yearly') {
    return 'monthly_general'
  }

  return 'general'
}

function extractExecutiveName(meeting, scheduledMeeting) {
  if (meeting?.notificationConfig?.executiveName) {
    return meeting.notificationConfig.executiveName
  }

  const meetingName = String(meeting?.name || scheduledMeeting.name || '')
  const oneOnOneMatch = meetingName.match(/1\s*-\s*1\s*w\s*(.+)$/i)
  if (oneOnOneMatch?.[1]) {
    return oneOnOneMatch[1].trim()
  }

  const attendees = splitAttendees(meeting?.attendees || scheduledMeeting.attendees || '')
  const nonRobin = attendees.find((item) => !/^robin$/i.test(item))

  return nonRobin ?? attendees[0] ?? meeting?.name ?? scheduledMeeting.name
}

function extractSecretaryName(meeting) {
  return meeting?.notificationConfig?.secretaryName || 'Robin'
}

function buildNoticeContext(template, meeting, scheduledMeeting, occurrences) {
  const primaryOccurrence = occurrences[0] ?? scheduledMeeting
  const latestOccurrence = occurrences[occurrences.length - 1] ?? primaryOccurrence
  const recentHistory =
    Array.isArray(meeting?.history) && meeting.history.length > 0
      ? meeting.history[meeting.history.length - 1]
      : ''
  return {
    '【会议名称】': scheduledMeeting.name,
    '【日期】': formatDisplayDate(primaryOccurrence.date),
    '【时间】': formatDisplayTime(primaryOccurrence.startTime, primaryOccurrence.endTime),
    '【月份】': `${new Date(primaryOccurrence.date).getMonth() + 1}月`,
    '【星期】': weekdayLabel(primaryOccurrence.date),
    '【参会人】': summarizeText(meeting?.attendees || scheduledMeeting.attendees, '相关同事'),
    '【高管名称】': extractExecutiveName(meeting, scheduledMeeting),
    '【秘书名称】': extractSecretaryName(meeting),
    '【安排列表】': buildArrangementList(occurrences),
    '【本阶段安排次数】': String(occurrences.length),
    '【首次安排日期】': formatDisplayDate(primaryOccurrence.date),
    '【最后安排日期】': formatDisplayDate(latestOccurrence.date),
    '【会议类型】': FREQUENCY_LABELS[scheduledMeeting.frequency] ?? '不定期',
    '【最近一次发生日期】': recentHistory || '无',
    '【备注摘要】': summarizeText(meeting?.notes || scheduledMeeting.notes, '无'),
  }
}

function buildNoticeText(template, meeting, scheduledMeeting, occurrences) {
  const content = template?.content ?? BUILT_IN_NOTICE_TEMPLATES.general.content
  const replacements = buildNoticeContext(template, meeting, scheduledMeeting, occurrences)

  return Object.entries(replacements).reduce(
    (current, [token, value]) => current.replaceAll(token, value),
    content,
  )
}

function extractTemplateTokens(content) {
  const matches = String(content || '').match(/【[^】]+】/g) ?? []
  return NOTICE_VARIABLE_OPTIONS.filter((token) => matches.includes(token))
}

const EDITABLE_NOTICE_TOKENS = new Set(['【高管名称】', '【秘书名称】'])

function copyText(text) {
  return navigator.clipboard.writeText(text)
}

export function ReserveNoticeBoard({
  meetings = [],
  schemeOptions = [],
  noticeTaskOptions = [],
  selectedTaskId = '',
  onTaskChange,
  noticeTemplates = [],
  disabledNoticeTemplateKeys = [],
  onToggleSent,
  onUpdateMeeting,
  onSaveTemplates,
}) {
  const [selectedId, setSelectedId] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [showTemplateManager, setShowTemplateManager] = useState(false)
  const [draftNoticeSettings, setDraftNoticeSettings] = useState(null)
  const [selectedSchemeId, setSelectedSchemeId] = useState('')
  const selectedTask =
    noticeTaskOptions.find((task) => task.id === selectedTaskId) ?? noticeTaskOptions[0] ?? null
  const activeSchemeId = schemeOptions.some((scheme) => scheme.id === selectedSchemeId)
    ? selectedSchemeId
    : schemeOptions[0]?.id ?? ''
  const selectedScheme = schemeOptions.find((scheme) => scheme.id === activeSchemeId) ?? null
  const scheduledMeetings = useMemo(
    () => selectedScheme?.scheduledMeetings ?? [],
    [selectedScheme],
  )
  const reserveNoticeStatus = useMemo(
    () => selectedScheme?.reserveNoticeStatus ?? {},
    [selectedScheme],
  )
  const meetingMap = useMemo(() => new Map(meetings.map((meeting) => [meeting.id, meeting])), [meetings])
  const mergedTemplates = useMemo(
    () => getMergedNoticeTemplates(noticeTemplates, disabledNoticeTemplateKeys),
    [disabledNoticeTemplateKeys, noticeTemplates],
  )
  const templateOptions = useMemo(
    () => getNoticeTemplateOptions(noticeTemplates, disabledNoticeTemplateKeys),
    [disabledNoticeTemplateKeys, noticeTemplates],
  )

  const rows = useMemo(() => {
    const grouped = new Map()

    scheduledMeetings
      .slice()
      .sort(
        (left, right) =>
          left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime),
      )
      .forEach((scheduledMeeting) => {
        const sourceMeeting = scheduledMeeting.meetingId ? meetingMap.get(scheduledMeeting.meetingId) : null
        const groupId = scheduledMeeting.meetingId
          ? `meeting:${scheduledMeeting.meetingId}`
          : `adhoc:${scheduledMeeting.id}`

        if (!grouped.has(groupId)) {
          const templateKey = resolveTemplateKey(sourceMeeting, scheduledMeeting, mergedTemplates)
          grouped.set(groupId, {
            id: groupId,
            meeting: sourceMeeting,
            scheduledMeeting,
            sent: Boolean(reserveNoticeStatus[groupId]),
            template: mergedTemplates[templateKey] ?? BUILT_IN_NOTICE_TEMPLATES.general,
            occurrences: [],
          })
        }

        grouped.get(groupId).occurrences.push(scheduledMeeting)
      })

    return Array.from(grouped.values()).map((row) => ({
      ...row,
      tokens: extractTemplateTokens(row.template.content),
      context: buildNoticeContext(row.template, row.meeting, row.scheduledMeeting, row.occurrences),
      text: buildNoticeText(row.template, row.meeting, row.scheduledMeeting, row.occurrences),
    }))
  }, [meetingMap, mergedTemplates, reserveNoticeStatus, scheduledMeetings])

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const search = searchText.trim().toLowerCase()
      if (search) {
        const haystack =
          `${row.scheduledMeeting.name} ${row.scheduledMeeting.attendees || ''} ${row.text}`.toLowerCase()
        if (!haystack.includes(search)) return false
      }

      if (filterType === 'unsent') return !row.sent
      if (filterType === 'sent') return row.sent
      return true
    })
  }, [filterType, rows, searchText])

  const selectedRow =
    filteredRows.find((row) => row.id === selectedId) ??
    rows.find((row) => row.id === selectedId) ??
    filteredRows[0] ??
    null
  const selectedDraft =
    selectedRow?.meeting && draftNoticeSettings?.rowId === selectedRow.id ? draftNoticeSettings : null
  const selectedPreviewMeeting = useMemo(
    () =>
      selectedRow?.meeting
        ? {
            ...selectedRow.meeting,
            notificationTemplateKey: selectedDraft?.templateKey ?? selectedRow.meeting.notificationTemplateKey ?? '',
            notificationConfig: {
              ...(selectedRow.meeting.notificationConfig ?? {}),
              executiveName: selectedDraft?.executiveName ?? selectedRow.meeting.notificationConfig?.executiveName ?? '',
              secretaryName: selectedDraft?.secretaryName ?? selectedRow.meeting.notificationConfig?.secretaryName ?? '',
            },
          }
        : selectedRow?.meeting ?? null,
    [selectedDraft, selectedRow],
  )
  const selectedPreviewTemplateKey = selectedRow
    ? resolveTemplateKey(selectedPreviewMeeting, selectedRow.scheduledMeeting, mergedTemplates)
    : ''
  const selectedPreviewTemplate = selectedRow
    ? mergedTemplates[selectedPreviewTemplateKey] ?? BUILT_IN_NOTICE_TEMPLATES.general
    : null
  const selectedPreviewTokens = useMemo(
    () => extractTemplateTokens(selectedPreviewTemplate?.content),
    [selectedPreviewTemplate],
  )
  const selectedPreviewContext = useMemo(
    () =>
      selectedRow
        ? buildNoticeContext(
            selectedPreviewTemplate,
            selectedPreviewMeeting,
            selectedRow.scheduledMeeting,
            selectedRow.occurrences,
          )
        : {},
    [selectedPreviewMeeting, selectedPreviewTemplate, selectedRow],
  )
  const selectedPreviewText = useMemo(
    () =>
      selectedRow
        ? buildNoticeText(
            selectedPreviewTemplate,
            selectedPreviewMeeting,
            selectedRow.scheduledMeeting,
            selectedRow.occurrences,
          )
        : '',
    [selectedPreviewMeeting, selectedPreviewTemplate, selectedRow],
  )

  const sentCount = useMemo(() => rows.filter((row) => row.sent).length, [rows])
  const unsentCount = rows.length - sentCount
  const selectedOccurrenceRange = selectedRow ? buildOccurrenceRangeLabel(selectedRow.occurrences) : '暂无安排'
  const selectedAttendees = selectedRow
    ? summarizeText(selectedRow.meeting?.attendees || selectedRow.scheduledMeeting.attendees, '未填写参会人')
    : '未填写参会人'
  const selectedNotes = selectedRow
    ? summarizeText(selectedRow.meeting?.notes || selectedRow.scheduledMeeting.notes, '无备注')
    : '无备注'

  function handleTaskChange(taskId) {
    setSelectedId('')
    setSelectedSchemeId('')
    onTaskChange?.(taskId)
  }

  function handleSchemeChange(schemeId) {
    setSelectedId('')
    setSelectedSchemeId(schemeId)
  }

  return (
    <section className="panel reserve-notice-shell">
      <div className="reserve-notice-topbar">
        <div className="reserve-task-selector">
          <div>
            <span>通知任务来源</span>
            <strong>{selectedTask?.name ?? '请选择已排程任务'}</strong>
          </div>
          <select
            value={selectedTask?.id ?? ''}
            onChange={(event) => handleTaskChange(event.target.value)}
            disabled={noticeTaskOptions.length === 0}
          >
            {(noticeTaskOptions.length > 0 ? noticeTaskOptions : [{ id: 'empty', name: '暂无已排程任务' }]).map((task) => (
              <option key={task.id} value={task.id}>
                {task.name}
              </option>
            ))}
          </select>
        </div>
        <div className="reserve-task-selector reserve-scheme-selector">
          <div>
            <span>排程方案</span>
            <strong>{selectedScheme?.label ?? '请选择排程方案'}</strong>
          </div>
          <select
            value={activeSchemeId}
            onChange={(event) => handleSchemeChange(event.target.value)}
            disabled={schemeOptions.length === 0}
          >
            {(schemeOptions.length > 0 ? schemeOptions : [{ id: 'empty', label: '暂无排程方案' }]).map((scheme) => (
              <option key={scheme.id} value={scheme.id}>
                {scheme.label}
              </option>
            ))}
          </select>
        </div>
        <div className="reserve-notice-progress">
          <CheckCircle2 size={15} />
          <strong>{sentCount}</strong>
          <span>/</span>
          <span>{rows.length} 条已发送</span>
        </div>
        <div className="reserve-notice-summary-cards">
          <div className="reserve-notice-summary-card">
            <span>待发送</span>
            <strong>{unsentCount}</strong>
          </div>
          <div className="reserve-notice-summary-card">
            <span>已发送</span>
            <strong>{sentCount}</strong>
          </div>
          <div className="reserve-notice-summary-card">
            <span>排程状态</span>
            <strong>{selectedTask?.status ?? '待选择'}</strong>
          </div>
        </div>
      </div>

      <div className="reserve-notice-layout">
        <div className="reserve-notice-list-panel">
          <div className="reserve-notice-toolbar">
            <label className="final-check-search">
              <Search size={15} />
              <input
                type="text"
                placeholder="搜索会议名称或通知内容"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
              />
            </label>
            <div className="final-check-filters">
              <button
                type="button"
                className={filterType === 'all' ? 'final-check-filter final-check-filter-active' : 'final-check-filter'}
                onClick={() => setFilterType('all')}
              >
                全部
              </button>
              <button
                type="button"
                className={filterType === 'unsent' ? 'final-check-filter final-check-filter-active' : 'final-check-filter'}
                onClick={() => setFilterType('unsent')}
              >
                未发送
              </button>
              <button
                type="button"
                className={filterType === 'sent' ? 'final-check-filter final-check-filter-active' : 'final-check-filter'}
                onClick={() => setFilterType('sent')}
              >
                已发送
              </button>
            </div>
          </div>

          <div className="reserve-notice-list">
            {filteredRows.map((row) => (
              <article
                key={row.id}
                className={
                  row.id === selectedRow?.id
                    ? 'reserve-notice-item reserve-notice-item-active'
                    : 'reserve-notice-item'
                }
                onClick={() => setSelectedId(row.id)}
              >
                <div className="reserve-notice-item-head">
                  <div className="reserve-notice-item-title">
                    <strong>{row.scheduledMeeting.name}</strong>
                    <span className={`final-check-frequency-mark final-check-frequency-mark-${row.scheduledMeeting.frequency === 'weekly' ? 'blue' : row.scheduledMeeting.frequency === 'monthly' ? 'green' : row.scheduledMeeting.frequency === 'yearly' ? 'orange' : 'gray'}`}>
                      {FREQUENCY_LABELS[row.scheduledMeeting.frequency] ?? '不定期'}
                    </span>
                  </div>
                  <label className="final-check-checkbox" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={row.sent}
                      onChange={() => onToggleSent(row.id, selectedScheme)}
                    />
                    <span>{row.sent ? '已发送' : '未发送'}</span>
                  </label>
                </div>

                <div className="reserve-notice-item-meta">
                  <span>{row.sent ? '已发送' : '待发送'}</span>
                  <span>本阶段 {row.occurrences.length} 次</span>
                  <span>{buildOccurrenceRangeLabel(row.occurrences)}</span>
                  <span>{row.template.label}</span>
                </div>

                <div className="reserve-notice-item-detail">
                  <div className="reserve-notice-item-detail-block">
                    <span className="final-check-item-label">参会人</span>
                    <p>{summarizeText(row.meeting?.attendees || row.scheduledMeeting.attendees, '未填写参会人')}</p>
                  </div>
                  <div className="reserve-notice-item-detail-block">
                    <span className="final-check-item-label">通知重点</span>
                    <p>{summarizeText(row.meeting?.notes || row.scheduledMeeting.notes, '无备注重点')}</p>
                  </div>
                  <div className="reserve-notice-item-detail-block reserve-notice-item-detail-block-wide">
                    <span className="final-check-item-label">通知预览</span>
                    <p>{row.id === selectedRow?.id ? selectedPreviewText || row.text : row.text}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="reserve-notice-preview-panel">
          {selectedRow ? (
            <>
              <div className="reserve-notice-preview-head">
                <div>
                  <h3>{selectedRow.scheduledMeeting.name}</h3>
                  <p>
                    {selectedRow.occurrences.length} 次安排 · {selectedOccurrenceRange}
                  </p>
                </div>
                <div className="reserve-notice-preview-actions">
                  <button className="ghost-button" onClick={() => setShowTemplateManager(true)}>
                    <PencilLine size={16} />
                    管理模板
                  </button>
                  <button className="ghost-button" onClick={() => onToggleSent(selectedRow.id, selectedScheme)}>
                    <CheckCircle2 size={16} />
                    {selectedRow.sent ? '取消已发送' : '标记已发送'}
                  </button>
                  <button className="primary-button" onClick={() => copyText(selectedRow.text)}>
                    <Copy size={16} />
                    复制通知文案
                  </button>
                </div>
              </div>

              <div className="reserve-notice-preview-meta">
                <span>{selectedPreviewTemplate?.label ?? selectedRow.template.label}</span>
                <span>{FREQUENCY_LABELS[selectedRow.scheduledMeeting.frequency] ?? '不定期'}</span>
                <span>{selectedRow.scheduledMeeting.duration} 分钟</span>
                <span>{selectedRow.occurrences.length} 个安排时间</span>
              </div>

              <div className="reserve-notice-preview-context-grid">
                <div className="reserve-notice-context-card">
                  <span className="final-check-item-label">参会人</span>
                  <p>{selectedAttendees}</p>
                </div>
                <div className="reserve-notice-context-card">
                  <span className="final-check-item-label">安排范围</span>
                  <p>{selectedOccurrenceRange}</p>
                </div>
                <div className="reserve-notice-context-card reserve-notice-context-card-wide">
                  <span className="final-check-item-label">备注重点</span>
                  <p>{selectedNotes}</p>
                </div>
              </div>

              <div className="reserve-notice-arrangement-card">
                <div className="reserve-notice-arrangement-head">
                  <strong>本次通知覆盖的安排</strong>
                  <span>{selectedRow.occurrences.length} 条</span>
                </div>
                <div className="reserve-notice-arrangement-list">
                  {selectedRow.occurrences.map((item) => (
                    <div key={item.id} className="reserve-notice-arrangement-item">
                      <strong>{formatDisplayDate(item.date)}</strong>
                      <span>{formatDisplayTime(item.startTime, item.endTime)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {selectedRow.meeting ? (
                <ReserveNoticeSettings
                  key={selectedRow.meeting.id}
                  rowId={selectedRow.id}
                  meeting={selectedPreviewMeeting}
                  templateOptions={templateOptions}
                  selectedTemplate={selectedPreviewTemplate}
                  templateTokens={selectedPreviewTokens}
                  templateContext={selectedPreviewContext}
                  onUpdateMeeting={onUpdateMeeting}
                  onOpenTemplateManager={() => setShowTemplateManager(true)}
                  onDraftChange={setDraftNoticeSettings}
                />
              ) : null}

              <div className="reserve-notice-preview-body">
                <pre>{selectedPreviewText || selectedRow.text}</pre>
              </div>
            </>
          ) : (
            <div className="empty-state">暂无通知</div>
          )}
        </div>
      </div>

      {showTemplateManager ? (
        <TemplateManagerModal
          templates={noticeTemplates}
          disabledBuiltInKeys={disabledNoticeTemplateKeys}
          onClose={() => setShowTemplateManager(false)}
          onSave={({ templates, disabledBuiltInKeys }) => {
            onSaveTemplates?.({
              templates: normalizeNoticeTemplates(templates),
              disabledBuiltInKeys,
            })
            setShowTemplateManager(false)
          }}
        />
      ) : null}
    </section>
  )
}

function ReserveNoticeSettings({
  rowId,
  meeting,
  onUpdateMeeting,
  templateOptions,
  selectedTemplate,
  templateTokens,
  templateContext,
  onOpenTemplateManager,
  onDraftChange,
}) {
  const [templateKey, setTemplateKey] = useState(meeting.notificationTemplateKey ?? '')
  const [executiveName, setExecutiveName] = useState(meeting.notificationConfig?.executiveName ?? '')
  const [secretaryName, setSecretaryName] = useState(meeting.notificationConfig?.secretaryName ?? '')
  const visibleTokens = templateTokens ?? []

  function syncDraft(patch = {}) {
    onDraftChange?.({
      rowId,
      templateKey: patch.templateKey ?? templateKey,
      executiveName: patch.executiveName ?? executiveName,
      secretaryName: patch.secretaryName ?? secretaryName,
    })
  }

  function saveNotificationConfig() {
    if (!onUpdateMeeting) return

    onUpdateMeeting(meeting.id, {
      notificationTemplateKey: templateKey,
      notificationConfig: {
        ...(meeting.notificationConfig ?? {}),
        executiveName: executiveName.trim(),
        secretaryName: secretaryName.trim(),
      },
    })
  }

  return (
    <div className="reserve-notice-settings">
      <div className="reserve-notice-settings-head">
        <strong>通知设置</strong>
        <span>仅影响通知文案</span>
      </div>
      <div className="reserve-notice-settings-grid">
        <label className="field">
          <span>通知模板</span>
          <select
            value={templateKey}
            onChange={(event) => {
              const nextValue = event.target.value
              setTemplateKey(nextValue)
              syncDraft({ templateKey: nextValue })
            }}
          >
            <option value="">自动匹配</option>
            {templateOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.isBuiltIn ? `${option.label}（内置）` : `${option.label}（自定义）`}
              </option>
            ))}
          </select>
        </label>
        <div className="reserve-notice-settings-inline-actions">
          <button type="button" className="ghost-button" onClick={onOpenTemplateManager}>
            <PencilLine size={16} />
            管理模板
          </button>
        </div>
        {visibleTokens.includes('【高管名称】') ? (
          <label className="field">
            <span>高管名称</span>
            <input
              value={executiveName}
              placeholder="按需填写"
              onChange={(event) => {
                const nextValue = event.target.value
                setExecutiveName(nextValue)
                syncDraft({ executiveName: nextValue })
              }}
            />
          </label>
        ) : null}
        {visibleTokens.includes('【秘书名称】') ? (
          <label className="field">
            <span>秘书名称</span>
            <input
              value={secretaryName}
              placeholder="默认 Robin"
              onChange={(event) => {
                const nextValue = event.target.value
                setSecretaryName(nextValue)
                syncDraft({ secretaryName: nextValue })
              }}
            />
          </label>
        ) : null}
      </div>
      <div className="reserve-notice-template-inspector">
        <div className="reserve-notice-template-card">
          <div className="reserve-notice-template-card-head">
            <strong>模板原文</strong>
            <span>{selectedTemplate?.label ?? '自动匹配模板'}</span>
          </div>
          <pre>{selectedTemplate?.content ?? BUILT_IN_NOTICE_TEMPLATES.general.content}</pre>
        </div>
        <div className="reserve-notice-template-card">
          <div className="reserve-notice-template-card-head">
            <strong>变量映射</strong>
            <span>仅显示已用变量</span>
          </div>
          <div className="reserve-notice-template-variable-grid">
            {visibleTokens.length > 0 ? (
              visibleTokens.map((token) => (
                <div
                  key={token}
                  className={
                    EDITABLE_NOTICE_TOKENS.has(token)
                      ? 'reserve-notice-template-variable-row reserve-notice-template-variable-row-editable'
                      : 'reserve-notice-template-variable-row'
                  }
                >
                  <strong>{token}</strong>
                  <span>{templateContext?.[token] ?? '无'}</span>
                </div>
              ))
            ) : (
              <div className="empty-state">未使用变量</div>
            )}
          </div>
        </div>
      </div>
      <div className="reserve-notice-settings-actions">
        <button className="ghost-button" onClick={saveNotificationConfig}>
          保存通知设置
        </button>
      </div>
    </div>
  )
}

function TemplateManagerModal({ templates, disabledBuiltInKeys = [], onClose, onSave }) {
  const [drafts, setDrafts] = useState(() => normalizeNoticeTemplates(templates))
  const [hiddenBuiltIns, setHiddenBuiltIns] = useState(() => disabledBuiltInKeys)
  const [selectedKey, setSelectedKey] = useState(() => normalizeNoticeTemplates(templates)[0]?.key ?? '')

  const selectedTemplate = drafts.find((item) => item.key === selectedKey) ?? drafts[0] ?? null

  function addTemplate() {
    const template = {
      key: `custom-${crypto.randomUUID()}`,
      label: '新模板',
      content: BUILT_IN_NOTICE_TEMPLATES.general.content,
      isBuiltIn: false,
    }
    setDrafts((current) => [...current, template])
    setSelectedKey(template.key)
  }

  function duplicateBuiltIn(templateKey) {
    const builtIn = BUILT_IN_NOTICE_TEMPLATES[templateKey]
    if (!builtIn) return

    const template = {
      key: `custom-${crypto.randomUUID()}`,
      label: `${builtIn.label}（副本）`,
      content: builtIn.content,
      isBuiltIn: false,
    }
    setDrafts((current) => [...current, template])
    setSelectedKey(template.key)
  }

  function hideBuiltIn(templateKey) {
    setHiddenBuiltIns((current) => Array.from(new Set([...current, templateKey])))
    if (selectedKey === templateKey) {
      setSelectedKey(drafts[0]?.key ?? '')
    }
  }

  function restoreBuiltIn(templateKey) {
    setHiddenBuiltIns((current) => current.filter((key) => key !== templateKey))
  }

  function updateTemplate(key, patch) {
    setDrafts((current) =>
      current.map((template) => (template.key === key ? { ...template, ...patch } : template)),
    )
  }

  function deleteTemplate(key) {
    setDrafts((current) => current.filter((template) => template.key !== key))
    if (selectedKey === key) {
      const fallback = drafts.find((template) => template.key !== key)
      setSelectedKey(fallback?.key ?? '')
    }
  }

  return (
    <div className="modal-backdrop modal-open" onClick={onClose}>
      <div className="modal-card modal-card-open modal-wide reserve-template-modal" onClick={(event) => event.stopPropagation()}>
        <div className="reserve-template-modal-head">
          <div>
            <h3>管理通知模板</h3>
            <p>内置模板只读，可复制为自定义模板；自定义模板可新增、修改和删除。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭模板管理">
            <X size={18} />
          </button>
        </div>

        <div className="reserve-template-modal-layout">
          <div className="reserve-template-library">
            <div className="reserve-template-section-head">
              <strong>内置模板</strong>
            </div>
            <div className="reserve-template-list">
              {Object.values(BUILT_IN_NOTICE_TEMPLATES)
                .filter((template) => !hiddenBuiltIns.includes(template.key))
                .map((template) => (
                  <div key={template.key} className="reserve-template-list-item reserve-template-list-item-built-in">
                    <div>
                      <strong>{template.label}</strong>
                      <span>内置模板，可复制或隐藏</span>
                    </div>
                    <div className="reserve-template-inline-actions">
                      <button type="button" className="icon-button" onClick={() => duplicateBuiltIn(template.key)} aria-label={`复制模板 ${template.label}`}>
                        <FilePlus2 size={16} />
                      </button>
                      <button type="button" className="icon-button danger-button-ghost" onClick={() => hideBuiltIn(template.key)} aria-label={`隐藏模板 ${template.label}`}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
            </div>

            {hiddenBuiltIns.length > 0 ? (
              <>
                <div className="reserve-template-section-head reserve-template-section-head-spaced">
                  <strong>已隐藏内置模板</strong>
                </div>
                <div className="reserve-template-list">
                  {BUILT_IN_NOTICE_TEMPLATE_KEYS.filter((key) => hiddenBuiltIns.includes(key)).map((key) => {
                    const template = BUILT_IN_NOTICE_TEMPLATES[key]
                    return (
                      <div key={template.key} className="reserve-template-list-item">
                        <div>
                          <strong>{template.label}</strong>
                          <span>已隐藏，可恢复使用</span>
                        </div>
                        <button type="button" className="ghost-button" onClick={() => restoreBuiltIn(template.key)}>
                          恢复
                        </button>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : null}

            <div className="reserve-template-section-head reserve-template-section-head-spaced">
              <strong>自定义模板</strong>
              <button type="button" className="ghost-button" onClick={addTemplate}>
                <FilePlus2 size={16} />
                新增模板
              </button>
            </div>

            <div className="reserve-template-list">
              {drafts.length > 0 ? (
                drafts.map((template) => (
                  <button
                    key={template.key}
                    type="button"
                    className={
                      template.key === selectedTemplate?.key
                        ? 'reserve-template-list-item reserve-template-list-item-active'
                        : 'reserve-template-list-item'
                    }
                    onClick={() => setSelectedKey(template.key)}
                  >
                    <div>
                      <strong>{template.label}</strong>
                      <span>自定义模板</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="empty-state">暂无自定义模板</div>
              )}
            </div>
          </div>

          <div className="reserve-template-editor">
            {selectedTemplate ? (
              <>
                <label className="field">
                  <span>模板名称</span>
                  <input
                    value={selectedTemplate.label}
                    onChange={(event) => updateTemplate(selectedTemplate.key, { label: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>模板内容</span>
                  <textarea
                    rows="10"
                    value={selectedTemplate.content}
                    onChange={(event) => updateTemplate(selectedTemplate.key, { content: event.target.value })}
                  />
                </label>

                <div className="reserve-template-variables">
                  <strong>可用变量</strong>
                  <div className="reserve-template-variable-list">
                    {NOTICE_VARIABLE_OPTIONS.map((token) => (
                      <button
                        key={token}
                        type="button"
                        className="reserve-template-variable"
                        onClick={() =>
                          updateTemplate(selectedTemplate.key, {
                            content: `${selectedTemplate.content}${selectedTemplate.content ? '\n' : ''}${token}`,
                          })
                        }
                      >
                        {token}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="reserve-template-editor-actions">
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => deleteTemplate(selectedTemplate.key)}
                  >
                    <Trash2 size={16} />
                    删除模板
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-state">请选择一个自定义模板进行编辑。</div>
            )}
          </div>
        </div>

        <div className="reserve-template-modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => onSave({ templates: drafts, disabledBuiltInKeys: hiddenBuiltIns })}
          >
            保存模板库
          </button>
        </div>
      </div>
    </div>
  )
}
