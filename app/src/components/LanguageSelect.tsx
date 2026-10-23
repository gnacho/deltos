import { useEffect, useRef, useState } from 'react'
import { Check, Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type LanguageValue = 'auto' | 'es' | 'en'

// Banderas SVG inline: los emojis de bandera no se renderizan de forma fiable
// dentro de un <select> nativo (LibreWolf/Firefox + GTK dibujan el desplegable
// el sistema operativo), así que el selector es propio y las banderas son
// vectores propios, idénticos en todos los navegadores.

function FlagES() {
  return (
    <svg viewBox="0 0 20 14" className="h-3.5 w-5 shrink-0 rounded-[2px] ring-1 ring-black/10" aria-hidden="true">
      <rect width="20" height="14" fill="#AA151B" />
      <rect y="3.5" width="20" height="7" fill="#F1BF00" />
      <rect x="5.5" y="5.2" width="3.4" height="3.6" rx="0.4" fill="#AD1519" stroke="#8a8a8a" strokeWidth="0.25" />
    </svg>
  )
}

function FlagUS() {
  const stripes = Array.from({ length: 6 }, (_, i) => (
    <rect key={i} y={14 / 13 + i * (28 / 13)} width="20" height={14 / 13} fill="#FFFFFF" />
  ))
  const stars = []
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      stars.push(<circle key={`${row}-${col}`} cx={1.1 + col * 1.7 + (row % 2 ? 0.85 : 0)} cy={1 + row * 1.9} r="0.5" fill="#FFFFFF" />)
    }
  }
  return (
    <svg viewBox="0 0 20 14" className="h-3.5 w-5 shrink-0 rounded-[2px] ring-1 ring-black/10" aria-hidden="true">
      <rect width="20" height="14" fill="#B22234" />
      {stripes}
      <rect width="9.6" height="7.6" fill="#3C3B6E" />
      {stars}
    </svg>
  )
}

function FlagAuto() {
  return (
    <span className="flex w-5 shrink-0 justify-center text-faint" aria-hidden="true">
      <Languages className="h-4 w-4" />
    </span>
  )
}

const OPTIONS: Array<{ value: LanguageValue; label: string; flag: () => React.ReactNode }> = [
  { value: 'auto', label: 'Auto', flag: FlagAuto },
  { value: 'es', label: 'Español', flag: FlagES },
  { value: 'en', label: 'English', flag: FlagUS },
]

export function LanguageSelect({
  value,
  onChange,
  ariaLabel,
  buttonClassName = '',
  align = 'left',
}: {
  value: LanguageValue
  onChange: (lang: LanguageValue) => void
  ariaLabel?: string
  buttonClassName?: string
  align?: 'left' | 'right'
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0]

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-9 items-center gap-2 rounded-lg border border-app bg-elevated px-2.5 text-[13px] text-text-primary outline-none hover:bg-surface focus:border-brand ${buttonClassName}`}
      >
        {current.flag()}
        <span>{current.value === 'auto' ? t('settings.langAuto') : current.label}</span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className={`absolute z-[80] mt-1 min-w-[170px] overflow-hidden rounded-lg border border-app bg-elevated py-1 shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-surface ${
                o.value === value ? 'text-text-primary' : 'text-text-muted'
              }`}
            >
              {o.flag()}
              <span className="flex-1">
                {o.value === 'auto' ? t('settings.langAuto') : o.label}
              </span>
              {o.value === value && <Check className="h-4 w-4 text-brand" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
