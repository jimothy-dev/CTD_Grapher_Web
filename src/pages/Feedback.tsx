import { useEffect, useState } from 'react'

// Two ways out for feedback, because the app has no server of its own.
// With a form endpoint configured at build time (a Formspree form URL, or
// Web3Forms with its access key; see the README), the form posts straight to
// it and the message arrives by email, no account needed. Without one, or as
// the public alternative, the form composes a GitHub issue on the project
// repository. The list below reads those issues back, so what others have
// sent publicly is visible here; entries that say who sent them sort first.
const REPO = 'jimothy-dev/CTD_Grapher_Web'
const PREFIX = 'Feedback: '
const ENDPOINT = ((import.meta.env.VITE_FEEDBACK_ENDPOINT as string | undefined) ?? '').trim()
const KEY = ((import.meta.env.VITE_FEEDBACK_KEY as string | undefined) ?? '').trim()

interface Entry { id: number; url: string; when: string; name: string; contact: string; text: string; open: boolean; comments: number }
interface Issue { number: number; html_url: string; title: string; body: string | null; created_at: string; state: string; comments: number; pull_request?: unknown; labels?: { name: string }[] }
// an issue counts as feedback when the page composed it (title prefix) or when it carries the feedback label
const isFeedback = (i: Issue) => !i.pull_request && (i.title.startsWith(PREFIX) || (i.labels ?? []).some(l => l.name === 'feedback'))

function parseIssue(i: Issue): Entry {
  const body = i.body ?? ''
  const field = (label: string) => { const m = body.match(new RegExp(`^${label}:\\s*(.*)$`, 'mi')); const v = (m?.[1] ?? '').trim(); return /^\(not given\)$|^-?$/.test(v) ? '' : v }
  const text = body.replace(/^(Name|Contact):.*$/gim, '').replace(/_Sent from the app.*$/is, '').trim() || (i.title.startsWith(PREFIX) ? i.title.slice(PREFIX.length) : i.title)
  return { id: i.number, url: i.html_url, when: i.created_at, name: field('Name'), contact: field('Contact'), text, open: i.state === 'open', comments: i.comments }
}
// who said it: name and contact first, contact only next, name only after that, nothing last
const rank = (e: Entry) => (e.name && e.contact ? 0 : e.contact ? 1 : e.name ? 2 : 3)

export default function Feedback() {
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle')
  const [list, setList] = useState<Entry[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let gone = false
    fetch(`https://api.github.com/repos/${REPO}/issues?state=all&per_page=100`, { headers: { Accept: 'application/vnd.github+json' } })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`GitHub answered ${r.status}`))))
      .then((issues: Issue[]) => { if (!gone) setList(issues.filter(isFeedback).map(parseIssue).sort((a, b) => rank(a) - rank(b) || b.when.localeCompare(a.when))) })
      .catch(e => { if (!gone) setError((e as Error).message) })
    return () => { gone = true }
  }, [])

  const message = text.trim()
  const title = PREFIX + (message.split(/\s+/).slice(0, 8).join(' ').slice(0, 70) || 'suggestion')
  const body = `Name: ${name.trim() || '(not given)'}\nContact: ${contact.trim() || '(not given)'}\n\n${message}\n\n_Sent from the app's Feedback page._`
  const githubHref = `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=feedback`
  const who = (e: Entry) => [e.name, e.contact].filter(Boolean).join(' · ') || 'anonymous'

  // The form posts the ordinary way, not through fetch: a plain form post
  // needs no cross-origin permission from the service, and if the service
  // puts up a bot check the visitor sees it and gets through. The service
  // sends the browser back here with ?sent=1.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('sent')) return
    setState('sent')
    history.replaceState(null, '', location.pathname + location.hash)
  }, [])
  const back = `${location.origin}${location.pathname}?sent=1#/feedback`

  return (
    <div className="about stack">
      <div>
        <h1>Feedback</h1>
        <p className="muted">An issue, a suggestion, a file that would not load. Name and contact are optional{ENDPOINT ? '; no account needed' : ''}.</p>
      </div>
      <form className="card stack" style={{ gap: 10 }} method="post" action={ENDPOINT || undefined} onSubmit={e => { if (!ENDPOINT || !message) e.preventDefault(); else setState('busy') }}>
        {ENDPOINT && KEY && <input type="hidden" name="access_key" value={KEY} />}
        {ENDPOINT && <input type="hidden" name="subject" value={title} />}
        {ENDPOINT && <input type="hidden" name="_subject" value={title} />}
        {ENDPOINT && <input type="hidden" name="redirect" value={back} />}
        {ENDPOINT && <input type="hidden" name="_next" value={back} />}
        {ENDPOINT && <input type="checkbox" name="botcheck" tabIndex={-1} aria-hidden="true" style={{ display: 'none' }} />}
        <div className="row">
          <label className="field" style={{ flex: '1 1 180px' }}>name (optional)<input name="name" value={name} onChange={e => setName(e.target.value)} placeholder="who you are" /></label>
          <label className="field" style={{ flex: '1 1 220px' }}>email or contact (optional)<input name="email" value={contact} onChange={e => setContact(e.target.value)} placeholder="so you can be answered" /></label>
        </div>
        <label className="field">your suggestion or issue
          <textarea name="message" value={text} onChange={e => { setText(e.target.value); if (state !== 'busy') setState('idle') }} rows={9} placeholder="What happened, or what would help. If a file would not load, say which instrument wrote it." style={{ resize: 'vertical', padding: '8px 10px', border: '1px solid var(--rule)', borderRadius: 8, background: 'var(--ground)', color: 'var(--ink)', font: 'inherit' }} />
        </label>
        {ENDPOINT ? (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">
              {state === 'sent' ? 'Sent. Thank you.' : 'Goes straight to the author by email; nothing is published.'}
              {' '}<a href={message ? githubHref : `https://github.com/${REPO}/issues`} target="_blank" rel="noopener noreferrer">{message ? 'Or post it publicly on GitHub' : 'Public feedback is on GitHub'}</a>.
            </span>
            <button type="submit" className="btn primary" disabled={!message || state === 'busy'}>{state === 'busy' ? 'sending…' : 'send'}</button>
          </div>
        ) : (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">Posts as an issue on the project's GitHub page, which needs a free GitHub account; what you write there, name and contact included, is public.</span>
            <a className={'btn primary' + (message ? '' : ' disabled')} href={message ? githubHref : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!message} onClick={e => { if (!message) e.preventDefault() }}>send via GitHub</a>
          </div>
        )}
      </form>
      <div className="card">
        <h2>Sent publicly</h2>
        {list === null && !error && <p className="muted small">Reading the list from GitHub…</p>}
        {error && <p className="muted small">The list could not be read ({error}); it is on <a href={`https://github.com/${REPO}/issues`} target="_blank" rel="noopener noreferrer">GitHub</a>.</p>}
        {list && list.length === 0 && <p className="muted small">Nothing yet.</p>}
        {list && list.length > 0 && (
          <ul className="feedback">
            {list.map(e => (
              <li key={e.id} className={e.open ? '' : 'closed'}>
                <div className="row small" style={{ justifyContent: 'space-between' }}>
                  <span><strong>{who(e)}</strong> <span className="muted">· {new Date(e.when).toLocaleDateString()}{e.open ? '' : ' · resolved'}</span></span>
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className="small">on GitHub{e.comments ? ` (${e.comments} ${e.comments === 1 ? 'reply' : 'replies'})` : ''}</a>
                </div>
                <p className="small" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{e.text.length > 400 ? e.text.slice(0, 400) + '…' : e.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
