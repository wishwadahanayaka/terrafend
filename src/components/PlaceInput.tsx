import { useId, useState } from 'react'
import { MapPin, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { OPEN_METEO_URL } from '../lib/backupSearch'
import { EMPTY_FIELD, routeErrorText, type PlaceField, type Point } from '../lib/routing'
import { usePlaceSearch } from '../lib/usePlaceSearch'

type Props = {
  label: string
  placeholder: string
  value: PlaceField
  onChange: (value: PlaceField) => void
  focus: Point
}

export default function PlaceInput({ label, placeholder, value, onChange, focus }: Props) {
  const { t } = useTranslation()
  const id = useId()
  const [open, setOpen] = useState(false)

  const search = usePlaceSearch(value.text, focus, open && !value.place)
  const showList = open && !value.place && value.text.trim().length >= 3

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          value={value.text}
          maxLength={100}
          autoComplete="off"
          placeholder={placeholder}
          // Editing after picking means the pick no longer applies
          onChange={(e) => {
            onChange({ text: e.target.value, place: null })
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          className="h-12 w-full rounded-xl border-2 border-slate-200 pl-3 pr-11 text-base text-slate-900 focus:border-blue-600 focus:outline-none"
        />
        {value.text && (
          <button
            type="button"
            aria-label={t('common.clear')}
            // Keeps the input focused, so the tap isn't swallowed by a blur
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange(EMPTY_FIELD)
              setOpen(true)
            }}
            className="absolute right-0 top-0 flex h-12 w-11 items-center justify-center text-slate-500"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {showList && (
        // mousedown is blocked so tapping a suggestion doesn't blur the input and close the list first
        <ul
          onMouseDown={(e) => e.preventDefault()}
          className="mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white"
        >
          {search.places.map((place, i) => (
            <li key={`${place.label}-${i}`}>
              <button
                type="button"
                onClick={() => {
                  onChange({ text: place.label, place })
                  setOpen(false)
                }}
                className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 active:bg-slate-100"
              >
                <MapPin className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                {place.label}
              </button>
            </li>
          ))}
          {search.places.length === 0 && (
            <li className="px-3 py-3 text-sm text-slate-500">
              {search.error ? routeErrorText(search.error) : search.searching ? t('search.searching') : t('search.none')}
            </li>
          )}
        </ul>
      )}
      {showList && search.backup && (
        // mousedown is blocked for the same reason as the list above, so the link can be tapped
        <p onMouseDown={(e) => e.preventDefault()} className="mt-1 px-1 text-xs text-slate-600">
          {t('search.backup')}{' '}
          <a href={OPEN_METEO_URL} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap underline">
            Open-Meteo.com
          </a>
        </p>
      )}
    </div>
  )
}
