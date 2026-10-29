import { useEffect } from 'react'

/** يضبط عنوان التبويب للصفحة الحالية ويرجّعه لما الصفحة تتفكّ. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    if (!title) return
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])
}
