export default function Notice({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p
      role="status"
      className="absolute inset-x-4 bottom-60 z-[1200] mx-auto w-fit max-w-xs rounded-2xl bg-slate-900 px-5 py-3 text-center text-sm font-medium text-white shadow-lg"
    >
      {message}
    </p>
  )
}
