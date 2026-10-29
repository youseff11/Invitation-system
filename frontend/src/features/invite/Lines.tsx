import { Fragment } from 'react'

/** نفس ‎linebreaksbr‎: السطر الجديد بيتحوّل ‎<br>‎ والباقي نص عادي (React بيهرّبه). */
export function Lines({ text }: { text: unknown }) {
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </>
  )
}
