import { useMemo, useState } from 'react'
import { Mail, Plus, Search, Trash2, UserRound, X } from 'lucide-react'
import { parseSecretaries } from '../../lib/contacts'

function createEmptyContact(name = '') {
  return {
    id: '',
    name,
    email: '',
    aliases: [],
    secretaries: [],
    department: '',
    title: '',
    notes: '',
    status: 'active',
  }
}

export function ContactsView({ contacts, onSaveContact, onDeleteContact }) {
  const [search, setSearch] = useState('')
  const [editingContact, setEditingContact] = useState(null)
  const filteredContacts = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return contacts

    return contacts.filter((contact) => {
      const haystack = [
        contact.name,
        contact.email,
        contact.department,
        contact.title,
        ...(contact.aliases ?? []),
        ...(contact.secretaries ?? []).flatMap((secretary) => [secretary.name, secretary.email]),
      ].join(' ').toLowerCase()

      return haystack.includes(keyword)
    })
  }, [contacts, search])

  const formData = editingContact ?? createEmptyContact()
  const linkedCount = contacts.filter((contact) => contact.email).length

  function updateForm(patch) {
    setEditingContact((current) => ({
      ...(current ?? createEmptyContact()),
      ...patch,
    }))
  }

  function updateSecretary(index, patch) {
    const secretaries = Array.isArray(formData.secretaries) ? formData.secretaries : parseSecretaries(formData.secretaries)
    updateForm({
      secretaries: secretaries.map((secretary, secretaryIndex) =>
        secretaryIndex === index ? { ...secretary, ...patch } : secretary,
      ),
    })
  }

  function addSecretary() {
    const secretaries = Array.isArray(formData.secretaries) ? formData.secretaries : parseSecretaries(formData.secretaries)
    updateForm({
      secretaries: [
        ...secretaries,
        {
          id: `sec-${crypto.randomUUID()}`,
          name: '',
          email: '',
        },
      ],
    })
  }

  function removeSecretary(index) {
    const secretaries = Array.isArray(formData.secretaries) ? formData.secretaries : parseSecretaries(formData.secretaries)
    updateForm({
      secretaries: secretaries.filter((_, secretaryIndex) => secretaryIndex !== index),
    })
  }

  function saveForm() {
    const nextContact = {
      ...formData,
      aliases: Array.isArray(formData.aliases)
        ? formData.aliases
        : String(formData.aliases || '')
          .split(/\n|,|，|、|；|;/)
          .map((item) => item.trim())
          .filter(Boolean),
      secretaries: parseSecretaries(formData.secretaries),
    }

    if (!nextContact.name.trim()) return
    onSaveContact(nextContact)
    setEditingContact(null)
  }

  return (
    <section className="contacts-workspace">
      <div className="panel contacts-list-panel">
        <div className="contacts-toolbar">
          <div>
            <strong>通讯录</strong>
            <span>{linkedCount} / {contacts.length} 已填写邮箱</span>
          </div>
          <button className="primary-button" type="button" onClick={() => setEditingContact(createEmptyContact())}>
            <Plus size={16} />
            新建联系人
          </button>
        </div>
        <div className="search-box contacts-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索姓名、邮箱或别名"
          />
        </div>
        <div className="contacts-table">
          {filteredContacts.map((contact) => (
            <button
              key={contact.id}
              type="button"
              className={
                editingContact?.id === contact.id
                  ? 'contact-row contact-row-active'
                  : 'contact-row'
              }
              onClick={() => setEditingContact(contact)}
            >
              <span className="contact-avatar"><UserRound size={15} /></span>
              <span className="contact-row-main">
                <strong>{contact.name || '未命名联系人'}</strong>
                <em>
                  {contact.secretaries?.length
                    ? `${contact.secretaries.length} 位秘书`
                    : contact.aliases?.length
                      ? contact.aliases.join('、')
                      : contact.department || '暂无别名'}
                </em>
              </span>
              <span className={contact.email ? 'contact-email' : 'contact-email contact-email-missing'}>
                <Mail size={13} />
                {contact.email || '未填写邮箱'}
              </span>
            </button>
          ))}
          {filteredContacts.length === 0 ? <div className="contacts-empty">没有找到联系人。</div> : null}
        </div>
      </div>

      <aside className="panel contacts-editor-panel">
        <div className="contacts-editor-head">
          <div>
            <strong>{formData.id ? '编辑联系人' : '新建联系人'}</strong>
            <span>用于会议参会人自动匹配与后续会邀发送。</span>
          </div>
        </div>
        <div className="contacts-editor-form">
          <label className="field">
            <span>姓名</span>
            <input
              value={formData.name}
              onChange={(event) => updateForm({ name: event.target.value })}
              placeholder="Robin"
            />
          </label>
          <label className="field">
            <span>邮箱</span>
            <input
              value={formData.email}
              onChange={(event) => updateForm({ email: event.target.value })}
              placeholder="robin@example.com"
            />
          </label>
          <label className="field">
            <span>别名</span>
            <input
              value={Array.isArray(formData.aliases) ? formData.aliases.join('、') : formData.aliases}
              onChange={(event) => updateForm({ aliases: event.target.value })}
              placeholder="英文名、中文名或常用简称，用顿号分隔"
            />
          </label>
          <label className="field">
            <span>秘书</span>
            <div className="secretary-fields">
              {(Array.isArray(formData.secretaries) ? formData.secretaries : parseSecretaries(formData.secretaries)).map((secretary, index) => (
                <div key={secretary.id || index} className="secretary-row">
                  <input
                    value={secretary.name}
                    onChange={(event) => updateSecretary(index, { name: event.target.value })}
                    placeholder="秘书姓名"
                  />
                  <input
                    value={secretary.email}
                    onChange={(event) => updateSecretary(index, { email: event.target.value })}
                    placeholder="秘书邮箱"
                  />
                  <button
                    type="button"
                    className="icon-button danger secretary-remove"
                    onClick={() => removeSecretary(index)}
                    aria-label="删除秘书"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button type="button" className="ghost-button secretary-add" onClick={addSecretary}>
                <Plus size={14} />
                添加秘书
              </button>
            </div>
          </label>
          <div className="contacts-editor-grid">
            <label className="field">
              <span>部门</span>
              <input
                value={formData.department}
                onChange={(event) => updateForm({ department: event.target.value })}
              />
            </label>
            <label className="field">
              <span>职务</span>
              <input
                value={formData.title}
                onChange={(event) => updateForm({ title: event.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>备注</span>
            <textarea
              rows="3"
              value={formData.notes}
              onChange={(event) => updateForm({ notes: event.target.value })}
            />
          </label>
        </div>
        <div className="panel-actions contacts-editor-actions">
          {formData.id ? (
            <button
              className="ghost-button danger"
              type="button"
              onClick={() => {
                onDeleteContact(formData.id)
                setEditingContact(null)
              }}
            >
              <Trash2 size={15} />
              删除
            </button>
          ) : (
            <button className="ghost-button" type="button" onClick={() => setEditingContact(null)}>
              清空
            </button>
          )}
          <button className="primary-button" type="button" onClick={saveForm}>
            保存联系人
          </button>
        </div>
      </aside>
    </section>
  )
}
