import { useCallback, useEffect, useState } from 'react'

const NOTICE_MS = 4000

// A short message that goes away by itself. Used when a greyed-out button is tapped,
// because a disabled button gives no hint of why on a phone.
export function useNotice(): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!message) return
    const id = setTimeout(() => setMessage(null), NOTICE_MS)
    return () => clearTimeout(id)
  }, [message])

  const show = useCallback((text: string) => setMessage(text), [])
  return [message, show]
}
