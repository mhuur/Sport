import { useState, type RefObject } from 'react'
import { Check, Plus, Search } from 'lucide-react'
import { CATEGORIES, CATEGORY_META, PRESET_SUBTYPES, subtypesOf, type Category, type Exercise, type Measure } from '../types'
import { Seg } from './ui'

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Groupes de sous-types, comme la banque : un exercice multi-tags apparaît dans chacun */
function subtypeGroups(list: Exercise[]): [string, Exercise[]][] {
  const map = new Map<string, Exercise[]>()
  for (const e of list) {
    const sts = subtypesOf(e)
    for (const k of sts.length ? sts : ['']) {
      const arr = map.get(k)
      if (arr) arr.push(e)
      else map.set(k, [e])
    }
  }
  const rank = (k: string) => {
    if (!k) return 10000
    const i = PRESET_SUBTYPES.indexOf(k)
    return i === -1 ? 5000 : i
  }
  return [...map.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], 'fr'))
}

/**
 * Panneau de composition : TOUTE la banque, cherchable, avec un filtre de catégorie
 * (préréglé sur celle de la séance, libre ensuite — depuis le 06/09/2026 une séance mêle
 * des exercices de muscu, de HIIT et d'étirements : la catégorie de la séance ne borne
 * plus la liste, c'est son déroulé), qui RESTE ouverte — un tap ajoute l'exercice à la
 * séance sans rien fermer (remplace la Combobox qui se refermait après chaque ajout,
 * friction n° 1 de la création de séance). Affiché en volet latéral permanent sur
 * desktop (SessionForm) et dans une Sheet sur mobile. `counts` marque d'une coche les
 * exercices déjà dans la séance (re-tap = deuxième ajout, utile pour les blocs).
 * « + Créer » déplie une mini-ligne nom + sous-type + mesure : l'exercice naît classé
 * (dans la catégorie filtrée) et mesuré, plus besoin de repasser par la banque.
 */
export default function ExercisePicker({
  exercises,
  category,
  counts,
  onAdd,
  onCreate,
  searchRef,
}: {
  /** Toute la banque */
  exercises: Exercise[]
  /** Catégorie (déroulé) de la séance : filtre initial, et catégorie de création hors filtre */
  category: Category
  /** Nombre d'occurrences de chaque exercice déjà dans la séance */
  counts: Map<string, number>
  onAdd: (exId: string) => void
  onCreate: (draft: { name: string; subtype: string; measure: Measure; category: Category }) => void
  /** Le champ de recherche, pour lui donner le focus depuis le formulaire (volet desktop) */
  searchRef?: RefObject<HTMLInputElement | null>
}) {
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<Category | 'all'>(category)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSubtype, setNewSubtype] = useState('')
  // Un exercice créé depuis le sélecteur naît dans la catégorie filtrée
  const createCat: Category = cat === 'all' ? category : cat
  const [newMeasure, setNewMeasure] = useState<Measure>(createCat === 'etirements' ? 'sec' : 'reps')

  const pool = cat === 'all' ? exercises : exercises.filter((e) => e.category === cat)
  const q = norm(query.trim())
  const visible = q ? pool.filter((e) => norm(e.name).includes(q) || subtypesOf(e).some((st) => norm(st).includes(q))) : pool
  const hasExact = pool.some((e) => norm(e.name) === q)

  // Sous-types de la catégorie d'abord (les plus pertinents), presets ensuite
  const catSubtypes = [...new Set(pool.flatMap((e) => subtypesOf(e)))]
  const subtypeOptions = [...catSubtypes, ...PRESET_SUBTYPES.filter((st) => !catSubtypes.includes(st))]

  const startCreate = () => {
    setNewName(query.trim())
    setNewSubtype('')
    setNewMeasure(createCat === 'etirements' ? 'sec' : 'reps')
    setCreating(true)
  }
  const submitCreate = () => {
    if (!newName.trim()) return
    onCreate({ name: newName.trim(), subtype: newSubtype, measure: newMeasure, category: createCat })
    setCreating(false)
    setQuery('')
  }

  const label = createCat === 'etirements' ? 'posture' : 'exercice'
  // Mêmes tuiles que la rangée « Catégorie » de la fiche, en pleine largeur (cible tactile)
  const tile = (on: boolean) =>
    'flex h-8 flex-1 items-center justify-center rounded-xs border font-mono text-[8px] font-bold tracking-[0.06em] uppercase ' +
    (on ? '' : 'border-hairline-strong text-ink/50 active:bg-glass')

  return (
    <div className="flex min-h-0 flex-col">
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink/45" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Rechercher ou créer…`}
          aria-label="Rechercher un exercice"
          className="w-full rounded-sm border border-hairline bg-shoal py-2.5 pr-3 pl-9 text-sm font-semibold outline-none placeholder:font-normal placeholder:text-ink/40 focus:border-sage-500"
        />
      </div>
      <div className="mt-2 flex shrink-0 gap-1" role="group" aria-label="Filtrer par catégorie">
        <button
          type="button"
          aria-pressed={cat === 'all'}
          onClick={() => setCat('all')}
          className={tile(cat === 'all') + (cat === 'all' ? ' border-ink bg-ink text-onaccent' : '')}
        >
          Tous
        </button>
        {CATEGORIES.map((c) => {
          const m = CATEGORY_META[c]
          const on = cat === c
          return (
            <button
              key={c}
              type="button"
              title={m.label}
              aria-label={m.label}
              aria-pressed={on}
              onClick={() => setCat(c)}
              className={tile(on)}
              style={on ? { backgroundColor: m.hex + '29', borderColor: m.hex + '66', color: m.hex } : undefined}
            >
              {m.code}
            </button>
          )
        })}
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto [scrollbar-color:rgb(255_255_255/0.2)_transparent] [scrollbar-width:thin]">
        {subtypeGroups(visible).map(([subtype, exos]) => (
          <section key={subtype || '—'}>
            <p className="mb-1 px-1 font-mono text-[9px] tracking-[0.18em] uppercase text-sage-500">
              {subtype || 'Autres'}
            </p>
            <div>
              {exos.map((e, i) => {
                const n = counts.get(e.id) ?? 0
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onAdd(e.id)}
                    className={
                      'flex min-h-10 w-full items-center gap-2 px-1 text-left active:bg-glass ' +
                      (i > 0 ? 'border-t border-hairline' : '')
                    }
                  >
                    {/* Même police que la liste de la séance : un exercice a une seule tête, des deux côtés */}
                    <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">{e.name}</span>
                    {e.measure === 'sec' && (
                      <span className="shrink-0 rounded-full border border-hairline px-2 py-[3px] font-mono text-[8px] tracking-[0.1em] uppercase text-ink/60">
                        sec
                      </span>
                    )}
                    {n > 0 ? (
                      <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] tracking-[0.1em] uppercase text-sage-500">
                        <Check className="h-3.5 w-3.5" />
                        {n > 1 ? `×${n}` : ''}
                      </span>
                    ) : (
                      <Plus className="h-4 w-4 shrink-0 text-ink/40" />
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        ))}
        {visible.length === 0 && !q && (
          <p className="px-1 py-2 text-sm font-semibold text-ink/50">
            Aucun {label} {cat === 'all' ? '' : 'dans cette catégorie '}pour l'instant.
          </p>
        )}
        {!creating && q.length > 0 && !hasExact && (
          <button
            type="button"
            onClick={startCreate}
            className="w-full px-1 py-2.5 text-left text-sm font-extrabold text-sage-600 active:bg-glass"
          >
            + Créer « {query.trim()} »
          </button>
        )}
      </div>

      {creating && (
        <div className="mt-3 shrink-0 space-y-2 border-t border-hairline-strong pt-3">
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink/60">
            {createCat === 'etirements' ? 'Nouvelle posture' : 'Nouvel exercice'} · {CATEGORY_META[createCat].label}
          </p>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitCreate()
              }
            }}
            autoFocus
            placeholder="Nom"
            className="w-full rounded-sm border border-hairline bg-shoal px-3 py-2.5 text-sm font-semibold outline-none placeholder:font-normal placeholder:text-ink/40 focus:border-sage-500"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={newSubtype}
              onChange={(e) => setNewSubtype(e.target.value)}
              aria-label="Sous-type"
              className="w-full rounded-sm border border-hairline bg-shoal px-2.5 py-2 text-sm font-bold outline-none focus:border-sage-500"
            >
              <option value="">— Sous-type —</option>
              {subtypeOptions.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
            <Seg
              options={[
                { value: 'reps' as const, label: 'Reps' },
                { value: 'sec' as const, label: 'Secondes' },
              ]}
              value={newMeasure}
              onChange={setNewMeasure}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitCreate}
              disabled={!newName.trim()}
              className="flex-1 rounded-sm bg-sage-500 px-3 py-2.5 font-mono text-[11px] font-bold tracking-[0.14em] uppercase text-onaccent disabled:opacity-40"
            >
              Créer et ajouter
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-sm border border-hairline px-3 py-2.5 font-mono text-[11px] font-bold tracking-[0.14em] uppercase text-ink/60"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
