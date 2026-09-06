import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS, getEventCoordinates } from '@dnd-kit/utilities'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  GripVertical,
  LayoutGrid,
  Link2,
  Merge,
  MessageSquarePlus,
  Play,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { useData } from '../data/DataContext'
import {
  CATEGORIES,
  CATEGORY_META,
  setTargetsOf,
  type Category,
  type Measure,
  type Session,
  type SessionItem,
} from '../types'
import { DAY_LETTER, DAY_NAMES, addDays, formatShortFr, mondayIndex, toDateStr, todayStr } from '../lib/dates'
import { canonicalCycles, countWeekdays, cycleStepsOf, describeSchedule, diffDays, ownerOf, plannedSessionIdsOn } from '../lib/schedule'
import { isPlanLog, planToDoOn, warmupsDueOn } from '../lib/planDay'
import { usePlanningWeek } from '../lib/usePlanningWeek'
import { TYPE_META } from '../data/plan'
import { CategoryIcon, Chip, Combobox, Eyebrow, FormActions, PageHeader, Seg, Sheet, Stepper, glassCard } from '../components/ui'
import { DayDot, dayCell } from '../components/DayDot'
import ExercisePicker from '../components/ExercisePicker'

/* ── Vocabulaire de l'écran (maquette « Fiche séance », direction B, sept. 2026) ─────
 * Une carte de verre par section, des RANGÉES de 48 px « libellé mono à gauche, valeur
 * à droite », un filet entre les rangées. Les rangées portent leur `border-t` elles-mêmes
 * (pas de `divide-y`) parce que le drag & drop intercale des enveloppes entre la carte et
 * ses lignes. Toutes les actions de ligne sont des ICÔNES dans un carré à filet.
 */
const card = glassCard
const row = 'flex min-h-12 items-center gap-3 border-t border-hairline px-4'
const rowLabel = 'shrink-0 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-soft'
const iconBtn =
  'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-sm border border-hairline-strong bg-glass-soft text-ink/70 active:bg-glass'
const iconBtnOn = 'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-sm border border-ink bg-ink text-onaccent'
const iconBtnDanger =
  'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-sm border border-hiit/40 text-hiit active:bg-hiit/10'
const miniInput =
  'h-[30px] rounded-sm border border-hairline bg-glass-sunken text-center font-mono text-xs font-bold tabular-nums text-ink outline-none focus:border-sage-500'
/** Bascule reps / secondes : une valeur, pas une action — d'où la pilule texte */
const togglePill =
  'h-[30px] rounded-sm border border-hairline-strong px-2 font-mono text-[10px] font-bold tracking-[0.12em] uppercase text-ink/70 active:bg-glass'

/** Petit champ numérique à saisie directe (plus compact que le Stepper dans les listes) */
function MiniNum({ value, onChange, min = 0, max = 990, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label?: string }) {
  const [text, setText] = useState(String(value))
  const editingRef = useRef(false)
  useEffect(() => {
    if (!editingRef.current) setText(String(value))
  }, [value])
  const commit = (t: string) => {
    const n = Number(t.replace(',', '.'))
    if (t.trim() !== '' && !Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)))
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      value={text}
      onFocus={(e) => {
        editingRef.current = true
        e.target.select()
      }}
      onChange={(e) => {
        setText(e.target.value)
        commit(e.target.value)
      }}
      onBlur={() => {
        editingRef.current = false
        setText(String(value))
      }}
      className={miniInput + ' w-9'}
    />
  )
}

/** Case de jour de semaine (jours fixes ou jours de l'alternance) */
function DayButton({ d, on, onClick }: { d: number; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={DAY_NAMES[d]}
      aria-pressed={on}
      onClick={onClick}
      className={
        'flex h-9 w-9 items-center justify-center rounded-sm border font-mono text-[11px] font-bold transition-colors ' +
        (on ? 'border-ink bg-ink text-onaccent' : 'border-hairline-strong text-ink/60 active:bg-glass')
      }
    >
      {DAY_LETTER[d]}
    </button>
  )
}

/** Grille de l'aperçu : celle du Planning sans la poignée, jours en 24 px (28 dans le Planning) — rien
 *  ne s'y déplace, et la colonne du nom est déjà la plus étreinte dans une carte. */
const previewGrid = 'grid grid-cols-[minmax(0,1fr)_repeat(7,1.5rem)] items-center gap-x-0.5'

/** Ligne de l'aperçu : une séance (la fiche en cours, une autre, ou une course du plan)
 *  et ses sept ronds — mêmes `DayDot` que le Planning. La ligne de la fiche est teintée. */
function PreviewRow({
  id,
  title,
  code,
  hex,
  self,
  planned,
  done,
  todayIdx,
}: {
  id: string
  title: string
  code: string
  hex: string
  self?: boolean
  planned: boolean[]
  done: boolean[]
  todayIdx: number
}) {
  return (
    <div
      data-session={id}
      className={
        previewGrid + ' rounded-md border p-1 ' + (self ? 'border-sage-500/60 bg-sage-500/10' : 'border-hairline bg-glass-sunken')
      }
    >
      <div className="min-w-0 pl-1">
        <span className="block truncate font-display text-[15px] leading-[1.05] font-bold uppercase">{title}</span>
        <span className="block truncate font-mono text-[9px] tracking-[0.1em] uppercase" style={{ color: hex }}>
          {code}
        </span>
      </div>
      {Array.from({ length: 7 }, (_, d) => (
        <span key={d} className={dayCell(d === todayIdx)}>
          <DayDot state={done[d] ? 'done' : planned[d] ? 'planned' : 'none'} hex={hex} />
        </span>
      ))}
    </div>
  )
}

/** Item en cours d'édition : un uid transitoire identifie la ligne pour le drag & drop */
type DraftItem = SessionItem & { uid: string }
const newUid = () => crypto.randomUUID()

/** Tout l'état éditable du formulaire — l'instantané du garde-fou du retour, et le brouillon
 *  mis de côté quand on ouvre la fiche d'un exercice depuis la séance (bug du 05/09/2026 :
 *  cette navigation démontait le formulaire et perdait tout ce qui était en cours). */
interface Draft {
  name: string
  category: Category
  planMode: PlanMode
  days: number[]
  everyDays: number
  startDate: string
  steps: string[][]
  startStep: number
  items: SessionItem[]
  workSec: number
  restSec: number
  rounds: number
  stretchRest: number
  stretchRounds: number
  muscuRounds: number
  group: string
  warmupFor: Category | ''
}
const draftKeyOf = (id: string | undefined) => `elan-session-draft-${id ?? 'new'}`
/** Brouillon mis de côté pour cette fiche, consommé à la lecture (une seule restauration) ;
 *  ignoré passé une heure, pour ne pas ressusciter un vieux brouillon abandonné. */
function takeDraft(key: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    sessionStorage.removeItem(key)
    const { at, draft } = JSON.parse(raw) as { at: number; draft: Draft }
    return Date.now() - at < 3_600_000 ? draft : null
  } catch {
    return null
  }
}

/** Enveloppe sortable d'une ligne d'exercice — la poignée reçoit attributes/listeners.
 * Pendant un drag, la vignette qui suit le doigt est le DragOverlay : l'original reste
 * dans la liste en fantôme (opacity) et matérialise l'emplacement d'atterrissage. */
function SortableItem({
  uid,
  children,
}: {
  uid: string
  children: (drag: Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners'>) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: uid })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-30' : undefined}
    >
      {children({ attributes, listeners })}
    </div>
  )
}

/**
 * La vignette reste centrée sous le curseur, alignée sur la colonne (x figé).
 * Indispensable avec le repli des cartes : dnd-kit ancre l'overlay sur le rect
 * mesuré AVANT le repli, et la liste remonte de toute la hauteur perdue — sans
 * cette compensation la vignette flotte à des centimètres du pointeur et le
 * dépôt devient imprécis. Même transform pour la détection de collision.
 */
const followCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (!draggingNodeRect || !activatorEvent) return { ...transform, x: 0 }
  const grab = getEventCoordinates(activatorEvent)
  if (!grab) return { ...transform, x: 0 }
  return {
    ...transform,
    x: 0,
    y: transform.y + (grab.y - draggingNodeRect.top) - draggingNodeRect.height / 2,
  }
}

/** Les trois « quand » d'une séance : jours fixes, tous les X jours, avant une autre.
 *  L'alternance n'en fait plus partie (sept. 2026) : c'est une section à part, cumulable
 *  avec les deux premiers — Jours choisis + alternance = `repeat.onDays` + `steps`. */
type PlanMode = 'weekly' | 'every' | 'warmup'

/** Prochaine occurrence (aujourd'hui inclus) d'une cadence « tous les X jours » et son rang */
function nextEveryOccurrence(startDate: string, everyDays: number): { dateStr: string; index: number } {
  const diff = diffDays(startDate, todayStr())
  if (diff <= 0) return { dateStr: startDate, index: 0 }
  const index = Math.ceil(diff / everyDays)
  return { dateStr: toDateStr(addDays(new Date(startDate + 'T12:00:00'), index * everyDays)), index }
}

/** Prochaine date (aujourd'hui inclus) tombant sur un de ces jours de semaine */
function nextOccurrenceStr(days: number[]): string {
  const d = new Date()
  for (let i = 0; i < 7; i++) {
    if (days.includes(mondayIndex(d))) return toDateStr(d)
    d.setDate(d.getDate() + 1)
  }
  return todayStr()
}

/** Date k occurrences (parmi ces jours) avant `fromStr` — l'ancre qui fait tomber l'étape k sur fromStr */
function backOccurrences(fromStr: string, k: number, days: number[]): string {
  if (!days.length) return fromStr
  const d = new Date(fromStr + 'T12:00:00')
  let left = k
  while (left > 0) {
    d.setDate(d.getDate() - 1)
    if (days.includes(mondayIndex(d))) left--
  }
  return toDateStr(d)
}

export default function SessionForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { sessions, exercises, logs, addSession, updateSession, removeSession, updateExercise, addExercise } = useData()
  const existing = sessions.find((s) => s.id === id)

  // Cycle d'alternance : la séance « propriétaire » porte la planification, les
  // autres membres la voient et la modifient depuis leur propre fiche.
  const cycleOwner = existing ? ownerOf(existing.id, sessions) : undefined
  const ownerSteps = cycleOwner ? (canonicalCycles(sessions).get(cycleOwner.id) ?? []) : []
  // Identifiant de « cette séance » dans la rotation (placeholder tant qu'elle n'existe pas)
  const selfKey = existing?.id ?? '__self__'

  // Brouillon mis de côté par « Fiche exercice » (voir `Draft`) : lu une seule fois, au montage
  const draftKey = draftKeyOf(id)
  const draftRef = useRef<Draft | null | undefined>(undefined)
  if (draftRef.current === undefined) draftRef.current = takeDraft(draftKey)
  const d = draftRef.current

  const [name, setName] = useState(d?.name ?? existing?.name ?? '')
  const [category, setCategory] = useState<Category>(d?.category ?? existing?.category ?? 'muscu')
  // Jours de la séance : jours fixes (`days`) OU, en alternance, jours de semaine du cycle
  // (`repeat.onDays`) — mêmes cases, même état, seule l'écriture change
  const [days, setDays] = useState<number[]>(
    d ? d.days : cycleOwner?.repeat?.onDays?.length ? cycleOwner.repeat.onDays : (existing?.days ?? []),
  )
  // Jours choisis / tous les X jours / avant une autre (warmupFor) — un seul « quand »
  const [planMode, setPlanMode] = useState<PlanMode>(
    d
      ? d.planMode
      : cycleOwner
        ? cycleOwner.repeat?.onDays?.length
          ? 'weekly'
          : 'every'
        : existing?.warmupFor && !existing.days.length
          ? 'warmup'
          : 'weekly',
  )
  const [everyDays, setEveryDays] = useState(d?.everyDays ?? cycleOwner?.repeat?.everyDays ?? 2)
  const [startDate, setStartDate] = useState(d?.startDate ?? cycleOwner?.repeat?.startDate ?? todayStr())
  // Alternance en cours d'édition : un tableau de « crans » (A, B, C…), chacun regroupant
  // les séances faites ensemble ce jour-là (selfKey = cette séance). [[selfKey]] = pas
  // d'alternance.
  const [steps, setSteps] = useState<string[][]>(() => d?.steps ?? (ownerSteps.length ? ownerSteps : [[selfKey]]))
  // « Commencer par » : cran qui tombera à la prochaine occurrence — dérivé de l'ancre
  // stockée pour refléter la phase actuelle du cycle, dans les deux cadences.
  const [startStep, setStartStep] = useState(() => {
    if (d) return d.startStep
    const r = cycleOwner?.repeat
    if (!r || ownerSteps.length < 2) return 0
    if (r.onDays?.length) return countWeekdays(r.startDate, nextOccurrenceStr(r.onDays), r.onDays) % ownerSteps.length
    return nextEveryOccurrence(r.startDate, r.everyDays).index % ownerSteps.length
  })
  // `comment: ''` (un commentaire ajouté puis laissé vide — Firestore stocke les champs vidés
  // comme '') redevient « pas de commentaire » : le champ ne s'affiche que s'il y a du texte.
  const [items, setItems] = useState<DraftItem[]>(() =>
    (d?.items ?? existing?.items ?? []).map((it) => ({ ...it, comment: it.comment || undefined, uid: newUid() })),
  )
  const [workSec, setWorkSec] = useState(d?.workSec ?? existing?.workSec ?? 45)
  const [restSec, setRestSec] = useState(d?.restSec ?? existing?.restSec ?? 15)
  const [rounds, setRounds] = useState(d?.rounds ?? existing?.rounds ?? 2)
  const [stretchRest, setStretchRest] = useState(d?.stretchRest ?? (existing?.category === 'etirements' ? (existing.restSec ?? 0) : 5))
  const [stretchRounds, setStretchRounds] = useState(d?.stretchRounds ?? (existing?.category === 'etirements' ? (existing.rounds ?? 1) : 1))
  const [muscuRounds, setMuscuRounds] = useState(d?.muscuRounds ?? (existing?.category === 'muscu' ? (existing.rounds ?? 1) : 1))
  const [group, setGroup] = useState(d?.group ?? existing?.group ?? '')
  // Échauffement automatique : s'inviter dans Aujourd'hui les jours de telle catégorie
  const [warmupFor, setWarmupFor] = useState<Category | ''>(d?.warmupFor ?? existing?.warmupFor ?? '')
  // Sheet mobile du sélecteur d'exercices (sur desktop le volet est permanent)
  const [pickerOpen, setPickerOpen] = useState(false)
  // Section du planning + échauffement : options de niche, repliées derrière leur résumé
  const [optionsOpen, setOptionsOpen] = useState(false)
  // Sur desktop, « + Ajouter un exercice » envoie le focus dans la recherche du volet
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Sections déjà utilisées dans le planning, proposées dans la combobox
  const groupSuggestions = [...new Set(sessions.map((s) => (s.group ?? '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'fr'),
  )

  // --- Édition de l'alternance (simplifiée le 05/09/2026, retour utilisateur) : UNE séance
  // partenaire, choisie dans un sélecteur. `steps` garde sa forme générale (crans, plusieurs
  // séances par cran) pour lire les cycles existants, mais la fiche n'en crée plus : un cycle
  // complexe s'affiche en texte, avec une croix pour repartir de zéro.
  const simpleSteps = steps.length <= 2 && steps.every((st) => st.length === 1)
  const partnerId = simpleSteps ? steps.flat().find((id) => id !== selfKey) : undefined
  const partner = partnerId ? sessions.find((s) => s.id === partnerId) : undefined
  const setPartner = (id: string) =>
    setSteps((p) => {
      if (!id) return [[selfKey]]
      // Remplace le partenaire à sa place : l'ordre des crans porte la phase du cycle
      if (p.length === 2 && p.every((st) => st.length === 1)) return p.map((st) => (st[0] === selfKey ? st : [id]))
      return [[selfKey], [id]]
    })
  const nameOf = (id: string) => (id === selfKey ? name.trim() || 'Cette séance' : (sessions.find((s) => s.id === id)?.name ?? '?'))
  // « Commencer par » : les noms remplacent les lettres A/B. Sur mobile le rail ne tient
  // qu'une quarantaine de signes en tout : au-delà, chaque libellé est abrégé (`short`, le
  // nom complet reste en aria-label et sur desktop).
  const startOptions = (() => {
    const labels = steps.map((st) => st.map(nameOf).join(' + '))
    const total = labels.reduce((a, l) => a + l.length, 0)
    const cap = total > 40 ? Math.max(8, Math.floor(40 / labels.length)) : Infinity
    return labels.map((label, i) => ({
      value: String(i),
      label,
      short: label.length > cap ? label.slice(0, cap - 1).trimEnd() + '…' : undefined,
    }))
  })()

  const catExercises = exercises.filter((e) => e.category === category)
  const exOf = (exId: string) => exercises.find((e) => e.id === exId)
  const hasItems = category === 'muscu' || category === 'hiit' || category === 'etirements'
  // Blocs (muscu ET étirements) : découpage de la séance en groupes répétés indépendamment
  const canBlocks = category === 'muscu' || category === 'etirements'
  const hasBreaks = canBlocks && items.some((it, i) => i > 0 && it.blockBreak)
  const catMeta = CATEGORY_META[category]
  const itemWord = category === 'etirements' ? 'posture' : 'exercice'
  // Groupes de blocs pour l'affichage et le drag & drop (un seul bloc si pas de découpage)
  const blocksArr: DraftItem[][] = []
  items.forEach((it, i) => {
    if (i === 0 || (hasBreaks && it.blockBreak)) blocksArr.push([])
    blocksArr[blocksArr.length - 1].push(it)
  })
  const blockStarts: number[] = []
  {
    let acc = 0
    for (const b of blocksArr) {
      blockStarts.push(acc)
      acc += b.length
    }
  }

  const switchCategory = (c: Category) => {
    if (c === category) return
    if (items.length && !window.confirm('Changer de catégorie videra la liste des exercices de la séance. Continuer ?')) return
    setCategory(c)
    setItems([])
  }

  const toggleDay = (d: number) =>
    setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort((a, b) => a - b)))

  /**
   * Ajoute un exercice existant à la séance avec les réglages par défaut de la
   * catégorie. `measure` évite de dépendre de `exercises` pour un exercice qui
   * vient d'être créé (l'abonnement du store peut ne pas l'avoir encore livré).
   */
  const appendItem = (exId: string, measure?: Measure) => {
    const m = measure ?? exOf(exId)?.measure
    const base: DraftItem = { exerciseId: exId, uid: newUid() }
    if (category === 'muscu') {
      base.sets = 3
      base.target = m === 'sec' ? 30 : 10
      base.restSec = 60
    }
    if (category === 'etirements') {
      // Posture tenue (sec) ou mouvement compté (reps), selon la mesure de l'exercice
      if (m === 'reps') base.target = 10
      else base.durationSec = 30
    }
    setItems((p) => [...p, base])
  }

  /** Crée un exercice à la volée (mini-ligne du sélecteur) et l'ajoute à la séance */
  const quickCreate = async ({ name: nm, subtype, measure }: { name: string; subtype: string; measure: Measure }) => {
    if (!nm) return
    const exId = await addExercise({
      name: nm,
      category,
      subtypes: subtype ? [subtype] : [],
      subtype: '',
      measure,
      description: '',
      videoUrl: '',
      createdAt: Date.now(),
    })
    appendItem(exId, measure)
  }

  // Occurrences de chaque exercice déjà dans la séance (coches du sélecteur)
  const itemCounts = new Map<string, number>()
  for (const it of items) itemCounts.set(it.exerciseId, (itemCounts.get(it.exerciseId) ?? 0) + 1)

  const setItem = (idx: number, patch: Partial<SessionItem>) =>
    setItems((p) => p.map((it, i) => (i === idx ? { ...it, ...patch } : it)))

  // Retrait avec filet : le dernier exercice retiré reste annulable 6 s (un ✕ pendant
  // un drag raté coûtait la re-création de l'item et de tous ses réglages)
  const [removed, setRemoved] = useState<{ item: DraftItem; idx: number } | null>(null)
  const removedTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(removedTimer.current), [])
  const removeItem = (idx: number) => {
    const item = items[idx]
    if (!item) return
    setRemoved({ item, idx })
    window.clearTimeout(removedTimer.current)
    removedTimer.current = window.setTimeout(() => setRemoved(null), 6000)
    setItems((p) => p.filter((_, i) => i !== idx))
  }
  const undoRemove = () => {
    if (!removed) return
    window.clearTimeout(removedTimer.current)
    setItems((p) => {
      const list = [...p]
      list.splice(Math.min(removed.idx, list.length), 0, removed.item)
      return list
    })
    setRemoved(null)
  }

  // Drag & drop de la liste d'exercices (mêmes réglages tactiles que le Planning).
  // Pendant un drag (`dragId` posé), toutes les cartes se replient sur leur ligne de titre :
  // hauteurs uniformes → les échanges deviennent progressifs au lieu de sauter de la hauteur
  // d'une carte pleine, et la liste entière reste visible pour viser.
  const [dragId, setDragId] = useState<string | null>(null)
  // Lignes repliées par défaut, une seule dépliée à la fois, au CLIC partout — le survol
  // ouvrait les cartes au passage de la souris et faisait danser le layout (abandonné
  // août 2026). La ligne repliée = poignée + nom (+ commentaire) + résumé ; tout le reste
  // (réglages, actions, infos de l'exercice) n'apparaît qu'une fois dépliée.
  const [openUid, setOpenUid] = useState<string | null>(null)
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  )
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const aId = String(active.id)
    const oId = String(over.id)
    if (aId.startsWith('blk-')) {
      // Déplacer un bloc entier (glissé par son en-tête)
      setItems((p) => {
        const bl: DraftItem[][] = []
        p.forEach((it, i) => {
          if (i === 0 || it.blockBreak) bl.push([])
          bl[bl.length - 1].push(it)
        })
        const from = bl.findIndex((b) => 'blk-' + b[0].uid === aId)
        let to = bl.findIndex((b) => 'blk-' + b[0].uid === oId)
        if (to === -1) to = bl.findIndex((b) => b.some((x) => x.uid === oId))
        if (from === -1 || to === -1 || from === to) return p
        return arrayMove(bl, from, to).flatMap((b, bi) =>
          b.map((it, i) =>
            i === 0 ? { ...it, blockBreak: bi > 0, blockRounds: Math.max(1, it.blockRounds ?? 1) } : it,
          ),
        )
      })
      return
    }
    // Déplacer un exercice — si c'était la tête d'un bloc, le suivant hérite du bloc
    setItems((p) => {
      const from = p.findIndex((x) => x.uid === aId)
      let to = p.findIndex((x) => x.uid === oId)
      if (to === -1 && oId.startsWith('blk-')) to = p.findIndex((x) => 'blk-' + x.uid === oId)
      if (from === -1 || to === -1) return p
      let list = [...p]
      const moved = list[from]
      if (moved.blockBreak || from === 0) {
        const next = list[from + 1]
        if (next && !next.blockBreak) {
          list[from + 1] = { ...next, blockBreak: from > 0, blockRounds: moved.blockRounds ?? 1 }
        }
        list[from] = { ...moved, blockBreak: false, blockRounds: undefined }
      }
      list = arrayMove(list, from, to)
      if (list[0]?.blockBreak) list[0] = { ...list[0], blockBreak: false }
      return list
    })
  }

  /**
   * Écritures de planification que l'enregistrement applique aux AUTRES séances — et que
   * l'aperçu applique en mémoire, pour montrer exactement ce qui sera enregistré.
   *
   * En cycle (tous les X jours, ou jours fixes en alternance), la première séance du
   * premier cran devient propriétaire du `repeat` (alternance par crans, plusieurs séances
   * possibles le même jour) ; les autres membres sont nettoyés (plus de `repeat` propre ni
   * de jours fixes résiduels), et les anciens cycles qui revendiquent une séance du nôtre
   * sont réparés. Sans cycle (jours fixes seuls, avant une autre, ou alternance sans aucun
   * jour coché) : je quitte le cycle éventuel, qui continue sans moi.
   */
  const scheduleWrites = (selfId: string, pool: Session[] = sessions): { id: string; patch: Partial<Session> }[] => {
    const writes: { id: string; patch: Partial<Session> }[] = []
    const byId = (sid: string) => pool.find((x) => x.id === sid)

    // Nettoyer l'alternance saisie (doublons, séances disparues, crans vides)
    const seen = new Set<string>()
    const cleanSteps = steps
      .map((st) =>
        st
          .map((id) => (id === '__self__' ? selfId : id))
          .filter((id) => {
            if (seen.has(id) || (id !== selfId && !byId(id))) return false
            seen.add(id)
            return true
          }),
      )
      .filter((st) => st.length)
    const alternating = cleanSteps.length > 1 || (cleanSteps[0]?.length ?? 0) > 1
    // Un cycle n'a de sens qu'avec une cadence : tous les X jours, ou des jours de semaine
    // en alternance. Jours choisis sans alternance, avant une autre, ou alternance sans aucun
    // jour coché → pas de cycle — et surtout pas la cadence « tous les X jours » héritée
    // d'un autre onglet, invisible à l'écran (bug relevé le 05/09/2026).
    const cycle = planMode === 'every' || (planMode === 'weekly' && alternating && days.length > 0)

    if (!cycle) {
      const rest = ownerSteps.map((st) => st.filter((x) => x !== selfId && !!byId(x))).filter((st) => st.length)
      const restIds = rest.flat()
      if (cycleOwner?.repeat && restIds.length) {
        writes.push({
          id: rest[0][0],
          patch: {
            repeat: {
              everyDays: cycleOwner.repeat.everyDays,
              startDate: cycleOwner.repeat.startDate,
              ...(cycleOwner.repeat.onDays?.length ? { onDays: cycleOwner.repeat.onDays } : {}),
              steps: rest.map((ids) => ({ ids })),
            },
          },
        })
        for (const mid of restIds.slice(1)) {
          if (byId(mid)?.repeat) writes.push({ id: mid, patch: { repeat: null } })
        }
      }
      return writes
    }

    const allIds = cleanSteps.flat()
    const ownerId = cleanSteps[0][0]
    // « Commencer par » : ne réancre le cycle que si le cran choisi diffère de la phase
    // actuelle — sinon l'ancre stockée est conservée (l'historique affiché ne bouge pas).
    let cycleStart = startDate
    if (cleanSteps.length > 1) {
      const n = cleanSteps.length
      const chosen = startStep % n
      if (planMode === 'weekly') {
        const d0 = nextOccurrenceStr(days)
        if (countWeekdays(startDate, d0, days) % n !== chosen) cycleStart = backOccurrences(d0, chosen, days)
      } else {
        const next = nextEveryOccurrence(startDate, everyDays)
        const back = (((chosen - next.index) % n) + n) % n
        if (back) cycleStart = toDateStr(addDays(new Date(startDate + 'T12:00:00'), -back * everyDays))
      }
    }
    writes.push({
      id: ownerId,
      patch: {
        repeat: {
          everyDays,
          startDate: cycleStart,
          ...(planMode === 'weekly' ? { onDays: [...days].sort((a, b) => a - b) } : {}),
          steps: cleanSteps.map((ids) => ({ ids })),
        },
      },
    })
    // Les membres sont pilotés par l'alternance : ni repeat propre, ni jours fixes
    for (const mid of allIds) {
      if (mid === ownerId || mid === selfId) continue // la sauvegarde du formulaire nettoie déjà selfId
      const m = byId(mid)
      if (!m) continue
      const patch: Partial<Session> = {}
      if (m.repeat) patch.repeat = null
      if (m.days.length) patch.days = []
      if (Object.keys(patch).length) writes.push({ id: mid, patch })
    }
    // Répare les autres cycles qui revendiquent encore une séance du nôtre
    for (const s of pool) {
      if (!s.repeat || s.id === ownerId || allIds.includes(s.id)) continue
      const oSteps = cycleStepsOf(s)
      const kept = oSteps.map((st) => st.filter((x) => !allIds.includes(x))).filter((st) => st.length)
      if (kept.flat().length !== oSteps.flat().length) {
        writes.push({
          id: s.id,
          patch: {
            repeat: {
              everyDays: s.repeat.everyDays,
              startDate: s.repeat.startDate,
              ...(s.repeat.onDays?.length ? { onDays: s.repeat.onDays } : {}),
              steps: kept.map((ids) => ({ ids })),
            },
          },
        })
      }
    }
    return writes
  }
  const applySchedule = async (selfId: string) => {
    for (const w of scheduleWrites(selfId)) await updateSession(w.id, w.patch)
  }

  const noDays = planMode === 'weekly' && days.length === 0

  // --- Aperçu : la grille du Planning (une ligne par séance, un rond par jour, semaine
  // navigable), pour caler ce programme en fonction de ce qui est déjà posé — séances de
  // l'utilisateur et courses du plan. Calculé par SA fonction (plannedSessionIdsOn) sur une
  // copie des séances où cette fiche et ses écritures d'alternance sont appliquées.
  // Une seule source de vérité : l'aperçu ne peut pas mentir sur l'enregistrement.
  const [weekOffset, setWeekOffset] = useState(0)
  const { weekDates, todayIdx, planStates } = usePlanningWeek(weekOffset, logs)
  const preview = useMemo(() => {
    const draft: Session = {
      ...(existing ?? { items: [], createdAt: 0 }),
      id: selfKey,
      name: name.trim() || 'Ce programme',
      category,
      days: planMode === 'weekly' ? days : [],
      repeat: null,
      warmupFor: planMode === 'warmup' && warmupFor && warmupFor !== category ? warmupFor : null,
    }
    let pool = [...sessions.filter((s) => s.id !== selfKey), draft]
    for (const w of scheduleWrites(selfKey, pool)) pool = pool.map((s) => (s.id === w.id ? { ...s, ...w.patch } : s))
    const cycles = canonicalCycles(pool)
    const dueOn = (d: Date) => {
      const ids = plannedSessionIdsOn(d, pool, cycles)
      const me =
        planMode === 'warmup'
          ? warmupsDueOn(pool, planToDoOn(d, logs), ids, new Set()).some((s) => s.id === selfKey)
          : ids.has(selfKey)
      return { ids, me }
    }
    const byDay = weekDates.map((ds) => dueOn(new Date(ds + 'T12:00:00')))
    const doneByDay = weekDates.map((ds) => new Set(logs.filter((l) => l.date === ds && !isPlanLog(l)).map((l) => l.sessionId)))
    // Même filtre que le Planning : une séance sans jour n'encombre pas la grille
    const others = pool
      .filter(
        (s) =>
          s.id !== selfKey &&
          (s.days.length > 0 || !!s.repeat || !!ownerOf(s.id, pool, cycles) || doneByDay.some((ids) => ids.has(s.id))),
      )
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    const rows = [pool.find((s) => s.id === selfKey) ?? draft, ...others].map((s) => {
      const self = s.id === selfKey
      const cadence = ownerOf(s.id, pool, cycles) ? describeSchedule(s, pool, cycles) : undefined
      return {
        session: s,
        self,
        code: CATEGORY_META[s.category].code + (cadence ? ` · ↻ ${cadence}` : ''),
        planned: byDay.map((x) => (self ? x.me : x.ids.has(s.id))),
        done: doneByDay.map((ids) => ids.has(s.id)),
      }
    })
    let nextLabel = '—'
    for (let i = 0; i < 60; i++) {
      const d = addDays(new Date(), i)
      if (dueOn(d).me) {
        nextLabel = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + (i === 0 ? " (aujourd'hui)" : '')
        break
      }
    }
    return { rows, nextLabel }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, logs, existing, selfKey, name, category, planMode, days, everyDays, startDate, steps, startStep, warmupFor, weekDates[0]])

  const save = async () => {
    const maxOrder = sessions.reduce((a, s) => Math.max(a, s.sortOrder ?? -1), -1)
    const data = {
      name: name.trim() || 'Séance',
      category,
      days: planMode === 'weekly' ? days : [],
      // La planification par cycle est réécrite par applySchedule ci-dessous
      repeat: null,
      items: hasItems ? items.map(({ uid: _uid, ...rest }) => rest) : [],
      // Mesures, liens et notes ne s'éditent plus ici : on conserve l'existant
      metrics: existing?.metrics ?? [],
      links: existing?.links ?? [],
      notes: existing?.notes ?? '',
      group: group.trim(),
      // Firestore ne supprime pas les champs absents : null pour désactiver
      warmupFor: planMode === 'warmup' && warmupFor && warmupFor !== category ? warmupFor : null,
      sortOrder: existing?.sortOrder ?? maxOrder + 1,
      createdAt: existing?.createdAt ?? Date.now(),
      ...(category === 'hiit' ? { workSec, restSec, rounds } : {}),
      ...(category === 'etirements' ? { restSec: stretchRest, rounds: stretchRounds } : {}),
      ...(category === 'muscu' ? { rounds: muscuRounds } : {}),
    }
    let selfId: string
    if (existing) {
      await updateSession(existing.id, data)
      selfId = existing.id
    } else {
      selfId = await addSession(data)
    }
    await applySchedule(selfId)
    navigate(-1)
  }

  const duplicate = async () => {
    if (!existing) return
    const { id: _ignored, ...rest } = existing
    const maxOrder = sessions.reduce((a, s) => Math.max(a, s.sortOrder ?? -1), -1)
    await addSession({
      ...rest,
      name: existing.name + ' (copie)',
      days: [],
      repeat: null,
      sortOrder: maxOrder + 1,
      createdAt: Date.now(),
    })
    navigate('/library', { replace: true })
  }

  const del = async () => {
    if (!existing) return
    if (!window.confirm(`Supprimer la séance « ${existing.name} » ? L'historique déjà enregistré est conservé.`)) return
    await removeSession(existing.id)
    navigate('/library', { replace: true })
  }

  // Garde-fou du retour : « Retour » sur une fiche modifiée demandait zéro confirmation et
  // perdait tout en silence. On compare un instantané du formulaire à celui du montage.
  const draft: Draft = {
    name, category, planMode, days, everyDays, startDate, steps, startStep,
    items: items.map(({ uid: _uid, ...rest }) => rest),
    workSec, restSec, rounds, stretchRest, stretchRounds, muscuRounds, group, warmupFor,
  }
  const snapshot = JSON.stringify(draft)
  const initialRef = useRef<string | null>(null)
  // Formulaire restauré d'un brouillon : il diffère forcément de la séance enregistrée,
  // le retour doit demander confirmation ('' n'égale aucun instantané)
  if (initialRef.current === null) initialRef.current = d ? '' : snapshot
  const back = () => {
    if (snapshot === initialRef.current || window.confirm('Abandonner les modifications ?')) navigate(-1)
  }
  // « Fiche exercice » quitte la page : le brouillon est mis de côté et repris au retour
  const openExerciseSheet = (exId: string) => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), draft }))
    } catch {
      /* stockage indisponible : on navigue quand même */
    }
    navigate(`/exercise/${exId}`)
  }

  const addFromList = () => {
    // Desktop (≥ lg) : le volet est déjà là, on y envoie le focus ; mobile : la Sheet
    if (window.matchMedia('(min-width: 64rem)').matches && searchRef.current) searchRef.current.focus()
    else setPickerOpen(true)
  }

  const optionsSummary = group.trim() || 'Aucune section'

  return (
    // Avec des exercices à composer, l'écran passe en deux colonnes dès `lg` :
    // formulaire à gauche, banque d'exercices en volet permanent à droite —
    // l'espace desktop sert à composer au lieu de rester vide (audit août 2026).
    <div
      className={
        hasItems
          ? // Pas de `items-start` : l'aside doit s'étirer sur toute la hauteur de la
            // colonne formulaire, sinon son panneau sticky n'a aucune course pour coller
            'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-6 lg:pr-6'
          : 'mx-auto max-w-lg'
      }
    >
      <div className="min-w-0">
        <PageHeader title={existing ? 'Modifier la séance' : 'Nouvelle séance'} onBack={back} />

        <div className="space-y-5 px-5 pb-2">
          {/* ── Nom + catégorie ── */}
          <div className={card}>
            <div className={row + ' border-t-0'}>
              <label htmlFor="session-name" className={rowLabel}>
                Nom
              </label>
              <input
                id="session-name"
                type="text"
                value={name}
                placeholder="Ex. HIIT du mardi"
                onChange={(e) => setName(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-right text-[15px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink/40"
              />
            </div>
            <div className={row}>
              <span className={rowLabel}>Catégorie</span>
              {/* Tuiles de catégorie (les codes de CodeTile) — remplace le <select> natif dont le
                  popup restait illisible sous Windows */}
              <div className="ml-auto flex gap-1">
                {CATEGORIES.map((c) => {
                  const m = CATEGORY_META[c]
                  const on = c === category
                  return (
                    <button
                      key={c}
                      type="button"
                      title={m.label}
                      aria-label={m.label}
                      aria-pressed={on}
                      onClick={() => switchCategory(c)}
                      className={
                        'flex h-8 w-8 items-center justify-center rounded-xs border font-mono text-[8px] font-bold tracking-[0.06em] uppercase ' +
                        (on ? '' : 'border-hairline-strong text-ink/50 active:bg-glass')
                      }
                      style={on ? { backgroundColor: m.hex + '29', borderColor: m.hex + '66', color: m.hex } : undefined}
                    >
                      {m.code}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ── Exercices ── */}
          {hasItems && (
            <div className="space-y-2">
              <Eyebrow className="ml-1 text-ink/60">
                {category === 'etirements' ? 'Postures de la routine' : 'Exercices de la séance'}
              </Eyebrow>
              <div className={card}>
                {/* En-tête : compte + réglages de la séance (tours, effort/repos, transition) */}
                <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-1.5">
                  <span className={rowLabel + ' text-ink/45'}>
                    {items.length} {itemWord}
                    {items.length > 1 ? 's' : ''}
                    {hasBreaks ? ` · ${blocksArr.length} blocs` : ''}
                  </span>
                  <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {category === 'muscu' && !hasBreaks && (
                      <span className="flex items-center gap-2" title="Tours du circuit">
                        <span className={rowLabel}>Tours</span>
                        <Stepper value={muscuRounds} onChange={setMuscuRounds} min={1} max={10} small />
                      </span>
                    )}
                    {category === 'hiit' && (
                      <>
                        <span className="flex items-center gap-1.5">
                          <span className={rowLabel}>Effort</span>
                          <MiniNum value={workSec} onChange={setWorkSec} min={5} max={600} label="Secondes d'effort" />
                          <span className={rowLabel}>s</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className={rowLabel}>Repos</span>
                          <MiniNum value={restSec} onChange={setRestSec} min={0} max={600} label="Secondes de repos" />
                          <span className={rowLabel}>s</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className={rowLabel}>Tours</span>
                          <Stepper value={rounds} onChange={setRounds} min={1} small />
                        </span>
                      </>
                    )}
                    {category === 'etirements' && (
                      <>
                        {!hasBreaks && (
                          <span className="flex items-center gap-2" title="Tours de la routine">
                            <span className={rowLabel}>Tours</span>
                            <Stepper value={stretchRounds} onChange={setStretchRounds} min={1} max={10} small />
                          </span>
                        )}
                        <span className="flex items-center gap-1.5" title="Transition entre postures">
                          <span className={rowLabel}>Transition</span>
                          <MiniNum value={stretchRest} onChange={setStretchRest} min={0} max={120} label="Transition entre postures" />
                          <span className={rowLabel}>s</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <DndContext
                  sensors={dndSensors}
                  collisionDetection={closestCenter}
                  modifiers={[followCursor]}
                  // La ligne dépliée se referme au dragStart (les rangées du dessous remontent) :
                  // re-mesurer les cibles en continu, sinon dnd-kit garde les rects d'avant fermeture
                  measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
                  onDragStart={(e) => {
                    setOpenUid(null)
                    setDragId(String(e.active.id))
                  }}
                  onDragCancel={() => setDragId(null)}
                  onDragEnd={(e) => {
                    setDragId(null)
                    onDragEnd(e)
                  }}
                >
                  {/* UN SEUL SortableContext plat (en-têtes de bloc + lignes) : les contexts imbriqués
                      appliquaient un transform au bloc entier EN PLUS de celui des lignes — d'où les
                      trous géants et les chevauchements pendant le drag (retour utilisateur août 2026). */}
                  <SortableContext
                    items={
                      hasBreaks
                        ? blocksArr.flatMap((b) => ['blk-' + b[0].uid, ...b.map((x) => x.uid)])
                        : items.map((x) => x.uid)
                    }
                    strategy={verticalListSortingStrategy}
                  >
                    {blocksArr.map((blk, bi) => (
                      <div key={'blk-' + blk[0].uid}>
                        {hasBreaks && (
                          <SortableItem uid={'blk-' + blk[0].uid}>
                            {(blockDrag) => (
                              <div className={`flex min-h-10 items-center gap-2.5 border-t border-hairline px-4 ${catMeta.soft}`}>
                                <button
                                  type="button"
                                  aria-label={`Déplacer le bloc ${bi + 1}`}
                                  {...blockDrag.attributes}
                                  {...blockDrag.listeners}
                                  className="-ml-1.5 flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-ink-soft/40 active:cursor-grabbing"
                                >
                                  <GripVertical className="h-4 w-4" />
                                </button>
                                <span className={`font-mono text-[10px] font-bold tracking-[0.16em] uppercase ${catMeta.text}`}>
                                  Bloc {bi + 1}
                                </span>
                                <div className="ml-auto flex items-center gap-2">
                                  <span className={rowLabel}>Tours</span>
                                  <Stepper
                                    small
                                    value={items[blockStarts[bi]]?.blockRounds ?? 1}
                                    onChange={(v) => setItem(blockStarts[bi], { blockRounds: v })}
                                    min={1}
                                    max={10}
                                  />
                                  {bi > 0 && (
                                    <button
                                      type="button"
                                      aria-label="Fusionner avec le bloc précédent"
                                      title="Fusionner avec le bloc précédent"
                                      onClick={() => setItem(blockStarts[bi], { blockBreak: false })}
                                      className={iconBtn + ' ml-1 h-[26px] w-[26px]'}
                                    >
                                      <Merge className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </SortableItem>
                        )}
                        {blk.map((it, ii) => {
                          const idx = blockStarts[bi] + ii
                          const ex = exOf(it.exerciseId)
                          const isSec = ex?.measure === 'sec'
                          const isOpen = openUid === it.uid && !dragId
                          const summary =
                            category === 'muscu'
                              ? `${it.sets ?? 3} × ${it.targets ? setTargetsOf(it).join('/') : (it.target ?? 10)}${isSec ? ' s' : ''} · ${it.restSec ?? 60} s`
                              : category === 'etirements'
                                ? `${it.sets ?? 1} × ${!ex || isSec ? `${it.durationSec ?? 30} s` : `${it.target ?? 10} reps`}`
                                : ''
                          return (
                            <SortableItem key={it.uid} uid={it.uid}>
                              {(drag) => (
                                <div>
                                  {/* Ligne repliée : poignée · nom (+ commentaire) · résumé · chevron.
                                      Le clic n'importe où (hors contrôles) déplie SOUS la ligne. */}
                                  <div
                                    className={row + ' cursor-pointer'}
                                    onClick={(e) => {
                                      const t = e.target as Element
                                      if (t.closest('button,input,select,a')) return
                                      setOpenUid((u) => (u === it.uid ? null : it.uid))
                                    }}
                                  >
                                    <button
                                      type="button"
                                      aria-label={`Réordonner ${ex?.name ?? 'cet exercice'}`}
                                      {...drag.attributes}
                                      {...drag.listeners}
                                      className="-ml-1.5 flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-ink-soft/40 active:cursor-grabbing"
                                    >
                                      <GripVertical className="h-4 w-4" />
                                    </button>
                                    <div className="min-w-0 flex-1 py-2">
                                      <p className="truncate text-[15px] font-bold text-ink">{ex?.name ?? '—'}</p>
                                      {it.comment && !isOpen && (
                                        <p className="truncate text-xs font-semibold text-ink-soft">{it.comment}</p>
                                      )}
                                    </div>
                                    {summary && (
                                      <span className="shrink-0 font-mono text-[11px] tracking-[0.06em] uppercase tabular-nums text-ink-soft">
                                        {summary}
                                      </span>
                                    )}
                                    <ChevronDown
                                      className={
                                        'h-4 w-4 shrink-0 text-ink-soft/40 transition-transform duration-150 ' +
                                        (isOpen ? 'rotate-180 text-ink-soft/70' : '')
                                      }
                                    />
                                  </div>

                                  {/* Vrai dépliage : les lignes suivantes descendent (transition 150 ms) */}
                                  <div
                                    className={
                                      'overflow-hidden transition-all duration-150 ' +
                                      (isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0')
                                    }
                                  >
                                    <div className="space-y-2.5 border-t border-hairline py-3 pr-4 pl-11">
                                      {category === 'muscu' && (
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className={rowLabel}>Séries</span>
                                          <MiniNum
                                            value={it.sets ?? 3}
                                            onChange={(v) => {
                                              const patch: Partial<SessionItem> = { sets: v }
                                              if (it.targets) patch.targets = setTargetsOf({ ...it, sets: v })
                                              setItem(idx, patch)
                                            }}
                                            min={1}
                                            max={12}
                                            label="Séries"
                                          />
                                          <span className={rowLabel}>×</span>
                                          {it.targets ? (
                                            setTargetsOf(it).map((t, s) => (
                                              <MiniNum
                                                key={s}
                                                value={t}
                                                onChange={(v) =>
                                                  setItem(idx, { targets: setTargetsOf(it).map((x, j) => (j === s ? v : x)) })
                                                }
                                                min={1}
                                                label={`Objectif série ${s + 1}`}
                                              />
                                            ))
                                          ) : (
                                            <MiniNum value={it.target ?? 10} onChange={(v) => setItem(idx, { target: v })} min={1} label="Objectif par série" />
                                          )}
                                          <button
                                            type="button"
                                            title="Basculer répétitions / secondes"
                                            onClick={() => ex && void updateExercise(ex.id, { measure: isSec ? 'reps' : 'sec' })}
                                            className={togglePill}
                                          >
                                            {isSec ? 'sec' : 'reps'}
                                          </button>
                                          <span className="ml-auto flex items-center gap-1.5" title="Repos entre séries">
                                            <span className={rowLabel}>Repos</span>
                                            <MiniNum value={it.restSec ?? 60} onChange={(v) => setItem(idx, { restSec: v })} max={600} label="Repos entre séries" />
                                            <span className={rowLabel}>s</span>
                                          </span>
                                        </div>
                                      )}

                                      {category === 'etirements' && (
                                        <div className="flex flex-wrap items-center gap-2">
                                          {/* Séries de la posture : 2 × 30 s pour un étirement fait des deux côtés */}
                                          <span className={rowLabel}>Séries</span>
                                          <MiniNum value={it.sets ?? 1} onChange={(v) => setItem(idx, { sets: v })} min={1} max={6} label="Séries" />
                                          <span className={rowLabel}>×</span>
                                          {!ex || isSec ? (
                                            <>
                                              <MiniNum value={it.durationSec ?? 30} onChange={(v) => setItem(idx, { durationSec: v })} min={5} label="Durée de la posture" />
                                              <span className={rowLabel}>s</span>
                                            </>
                                          ) : (
                                            <>
                                              <MiniNum value={it.target ?? 10} onChange={(v) => setItem(idx, { target: v })} min={1} label="Répétitions" />
                                              <span className={rowLabel}>reps</span>
                                            </>
                                          )}
                                          <button
                                            type="button"
                                            title="Basculer secondes / répétitions (modifie l'exercice)"
                                            onClick={() => ex && void updateExercise(ex.id, { measure: isSec ? 'reps' : 'sec' })}
                                            className={togglePill + ' ml-auto'}
                                          >
                                            {isSec ? 'sec' : 'reps'}
                                          </button>
                                        </div>
                                      )}

                                      {it.comment !== undefined && (
                                        <input
                                          type="text"
                                          value={it.comment}
                                          onChange={(e) => setItem(idx, { comment: e.target.value })}
                                          onBlur={() => {
                                            // Laissé vide → le champ disparaît (retour à l'icône), rien n'est persisté
                                            if (!it.comment?.trim()) setItem(idx, { comment: undefined })
                                          }}
                                          autoFocus={it.comment === ''}
                                          placeholder="Commentaire (tempo, consigne…)"
                                          className="h-[34px] w-full rounded-sm border border-hairline bg-glass-sunken px-3 text-sm font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink/40 focus:border-sage-500"
                                        />
                                      )}

                                      {ex?.description && <p className="text-xs font-medium text-ink-soft/80">{ex.description}</p>}

                                      {/* Actions de la ligne, en icônes : varier · commenter · démo · fiche · retirer */}
                                      <div className="flex items-center gap-1.5">
                                        {category === 'muscu' && (
                                          <button
                                            type="button"
                                            aria-label="Varier les séries"
                                            aria-pressed={!!it.targets}
                                            title={it.targets ? 'Revenir à des séries identiques' : 'Varier l’objectif de chaque série (ex. 30 / 20 / 15)'}
                                            onClick={() =>
                                              setItem(
                                                idx,
                                                it.targets
                                                  ? { targets: undefined, target: setTargetsOf(it)[0] }
                                                  : { targets: setTargetsOf(it) },
                                              )
                                            }
                                            className={it.targets ? iconBtnOn : iconBtn}
                                          >
                                            <SlidersHorizontal className="h-[15px] w-[15px]" />
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          aria-label="Commentaire"
                                          aria-pressed={it.comment !== undefined}
                                          title="Ajouter un commentaire"
                                          onClick={() => {
                                            if (it.comment === undefined) setItem(idx, { comment: '' })
                                          }}
                                          className={it.comment !== undefined ? iconBtnOn : iconBtn}
                                        >
                                          <MessageSquarePlus className="h-[15px] w-[15px]" />
                                        </button>
                                        {ex?.videoUrl && (
                                          <a
                                            href={ex.videoUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            aria-label="Démo"
                                            title="Vidéo de démonstration"
                                            className={iconBtn}
                                          >
                                            <Play className="h-[15px] w-[15px]" />
                                          </a>
                                        )}
                                        {ex && (
                                          <button
                                            type="button"
                                            aria-label="Fiche exercice"
                                            title="Fiche exercice"
                                            onClick={() => openExerciseSheet(ex.id)}
                                            className={iconBtn}
                                          >
                                            <FileText className="h-[15px] w-[15px]" />
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          aria-label="Retirer"
                                          title="Retirer de la séance"
                                          onClick={() => removeItem(idx)}
                                          className={iconBtnDanger + ' ml-auto'}
                                        >
                                          <Trash2 className="h-[15px] w-[15px]" />
                                        </button>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Superset : une pastille posée sur le filet entre deux lignes */}
                                  {category === 'muscu' && idx < items.length - 1 && !items[idx + 1].blockBreak && (
                                    <div className="relative z-10 flex h-0 justify-center">
                                      <button
                                        type="button"
                                        aria-pressed={!!it.linkNext}
                                        title={it.linkNext ? 'Superset — enchaîné sans repos' : 'Enchaîner avec le suivant sans repos (superset)'}
                                        onClick={() => setItem(idx, { linkNext: !it.linkNext })}
                                        className={
                                          'flex h-6 -translate-y-1/2 items-center gap-1 rounded-full px-3 font-mono text-[9px] font-bold tracking-[0.12em] uppercase transition-colors ' +
                                          (it.linkNext ? 'bg-muscu text-onaccent shadow-sm' : 'border border-hairline-strong bg-shoal text-ink-soft')
                                        }
                                      >
                                        <Link2 className="h-3 w-3" />
                                        superset
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </SortableItem>
                          )
                        })}
                      </div>
                    ))}
                  </SortableContext>
                  {/* La vignette qui suit le doigt : compacte et opaque, elle ne cache plus la liste */}
                  <DragOverlay>
                    {dragId &&
                      (() => {
                        if (dragId.startsWith('blk-')) {
                          const bi = blocksArr.findIndex((b) => 'blk-' + b[0].uid === dragId)
                          if (bi === -1) return null
                          return (
                            <div className={`flex items-center gap-2.5 rounded-sm px-4 py-2 shadow-xl backdrop-blur-lg ${catMeta.soft}`}>
                              <GripVertical className="h-4 w-4 text-ink-soft/40" />
                              <span className={`font-mono text-[10px] font-bold tracking-[0.16em] uppercase ${catMeta.text}`}>
                                Bloc {bi + 1} · {blocksArr[bi].length} exo{blocksArr[bi].length > 1 ? 's' : ''}
                              </span>
                            </div>
                          )
                        }
                        const it = items.find((x) => x.uid === dragId)
                        const ex = it && exOf(it.exerciseId)
                        return (
                          <div className="flex items-center gap-3 rounded-sm border border-hairline bg-shoal px-4 py-2 shadow-xl">
                            <GripVertical className="h-4 w-4 shrink-0 text-ink-soft/40" />
                            <p className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">{ex?.name ?? '—'}</p>
                          </div>
                        )
                      })()}
                  </DragOverlay>
                </DndContext>

                {/* Pied de liste : ajouter (Sheet mobile / focus du volet desktop) · nouveau bloc */}
                <div className={row + ' min-h-11'}>
                  <button
                    type="button"
                    onClick={addFromList}
                    className="flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.14em] uppercase text-sage-600 active:text-sage-700"
                  >
                    <Plus className="h-3.5 w-3.5" /> Ajouter {category === 'etirements' ? 'une posture' : 'un exercice'}
                  </button>
                  {/* Un seul point de découpe, en bas : le dernier exercice démarre le nouveau bloc,
                      le drag & drop fait le reste (remplace les pilules entre chaque paire d'exercices) */}
                  {canBlocks && items.length >= 2 && !items[items.length - 1].blockBreak && (
                    <button
                      type="button"
                      title="Le dernier exercice démarre un nouveau bloc — glisses-y les autres"
                      onClick={() => {
                        const last = items.length - 1
                        setItem(last, { blockBreak: true, blockRounds: items[last].blockRounds ?? 1 })
                        setItem(last - 1, { linkNext: false })
                      }}
                      className="ml-auto flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-[0.14em] uppercase text-ink/60 active:text-ink"
                    >
                      <LayoutGrid className="h-3.5 w-3.5" /> nouveau bloc
                    </button>
                  )}
                </div>
                {category === 'hiit' && items.length > 0 && (
                  <p className="border-t border-hairline bg-glass-sunken px-4 py-2.5 text-center font-mono text-[10px] tracking-[0.12em] uppercase text-ink/45">
                    {items.length} exercice{items.length > 1 ? 's' : ''} × {rounds} tour{rounds > 1 ? 's' : ''} · {workSec} s
                    d'effort / {restSec} s de repos
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Planification ── */}
          <div className="space-y-2">
            <Eyebrow className="ml-1 text-ink/60">Planification</Eyebrow>
            <div className={card}>
              {/* Le « quand » : trois positions. L'alternance est une section à part, plus bas. */}
              <div className="px-3 py-2.5">
                <Seg
                  compact
                  options={[
                    { value: 'weekly' as const, label: 'Jours choisis' },
                    { value: 'every' as const, label: 'Tous les X jours' },
                    { value: 'warmup' as const, label: 'Avant une autre' },
                  ]}
                  value={planMode}
                  onChange={(v) => {
                    setPlanMode(v)
                    // « Avant une autre » sans cible n'a pas de sens : on présélectionne
                    if (v === 'warmup' && !warmupFor) setWarmupFor(CATEGORIES.find((c) => c !== category) ?? '')
                  }}
                />
              </div>

              {planMode === 'weekly' && (
                <div className={row + ' min-h-14'}>
                  <div className="flex w-full items-center justify-between">
                    {DAY_LETTER.map((_, d) => (
                      <DayButton key={d} d={d} on={days.includes(d)} onClick={() => toggleDay(d)} />
                    ))}
                  </div>
                </div>
              )}

              {/* Jumelée : s'invite dans Aujourd'hui les jours où une séance de la
                  catégorie cible est due (courses du plan comprises) — pas de jour propre.
                  Libellé au-dessus, chips en dessous : côte à côte, elles passaient sur deux
                  lignes et chevauchaient le libellé. */}
              {planMode === 'warmup' && (
                <div className={row + ' flex-col items-start gap-2.5 py-3'}>
                  <span className={rowLabel}>Avant chaque séance de</span>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.filter((c) => c !== category).map((c) => (
                      <Chip key={c} active={warmupFor === c} onClick={() => setWarmupFor(c)}>
                        {CATEGORY_META[c].label}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}

              {planMode === 'every' && (
                <div className={row}>
                  <span className={rowLabel}>Tous les</span>
                  <div className="ml-auto flex items-center gap-2">
                    <MiniNum value={everyDays} onChange={setEveryDays} min={1} max={30} label="Intervalle en jours" />
                    <span className={rowLabel}>jour{everyDays > 1 ? 's' : ''}</span>
                  </div>
                </div>
              )}
              {planMode === 'every' && (
                <div className={row}>
                  <span className={rowLabel}>À partir du</span>
                  {/* Champ natif habillé : le sélecteur reste celui du système (color-scheme: dark) */}
                  <input
                    type="date"
                    aria-label="Date de départ du cycle"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value || todayStr())}
                    className={miniInput + ' ml-auto px-2.5 text-left [&::-webkit-calendar-picker-indicator]:opacity-60'}
                  />
                </div>
              )}

              {/* ── En alternance avec : UNE séance partenaire (sélecteur « Aucune » → pastille avec sa
                  croix). Cumulable avec Jours choisis et Tous les X jours. Un cycle existant plus
                  complexe (trois crans, plusieurs séances le même jour) se lit en texte. ── */}
              {planMode !== 'warmup' && (
                <>
                  {partner ? (
                    <div className={row + ' flex-col items-stretch gap-2 py-3'}>
                      <span className={rowLabel}>En alternance avec</span>
                      <div
                        className={`flex h-[30px] items-center justify-between rounded-full border pl-3 pr-1 ${CATEGORY_META[partner.category].soft} ${CATEGORY_META[partner.category].text}`}
                        style={{ borderColor: CATEGORY_META[partner.category].hex + '73' }}
                      >
                        <span className="flex min-w-0 items-center gap-2 font-mono text-[10px] font-bold tracking-[0.08em] uppercase">
                          <CategoryIcon category={partner.category} className="h-3 w-3 shrink-0" />
                          <span className="truncate">{partner.name}</span>
                        </span>
                        <button
                          type="button"
                          aria-label="Retirer l'alternance"
                          onClick={() => setPartner('')}
                          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full opacity-75 active:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ) : !simpleSteps ? (
                    <div className={row + ' flex-col items-stretch gap-2 py-3'}>
                      <span className={rowLabel}>En alternance avec</span>
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 font-mono text-[10px] leading-relaxed font-bold tracking-[0.08em] uppercase text-ink/85">
                          {steps.map((st) => st.map(nameOf).join(' + ')).join(' → ')}
                        </span>
                        <button type="button" aria-label="Retirer l'alternance" onClick={() => setPartner('')} className={iconBtn}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={row}>
                      <span className={rowLabel}>En alternance avec</span>
                      <div className="relative ml-auto">
                        <select
                          aria-label="En alternance avec"
                          value=""
                          onChange={(e) => setPartner(e.target.value)}
                          className="h-[30px] appearance-none rounded-sm border border-hairline bg-glass-sunken pl-3 pr-7 font-mono text-[10px] tracking-[0.14em] uppercase text-ink/70 outline-none focus:border-sage-500"
                        >
                          <option value="">Aucune</option>
                          {sessions
                            .filter((s) => s.id !== existing?.id)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-ink/60" />
                      </div>
                    </div>
                  )}
                  {steps.length > 1 && (planMode === 'every' || days.length > 0) && (
                    <div className={row + ' flex-col items-stretch gap-2 py-3'}>
                      <span className={rowLabel}>Commencer par</span>
                      <Seg
                        compact
                        options={startOptions}
                        value={String(startStep % steps.length)}
                        onChange={(v) => setStartStep(Number(v))}
                      />
                    </div>
                  )}
                </>
              )}

              {/* ── Aperçu : la grille du Planning, semaine par semaine, avec tout ce qui est déjà posé ── */}
              <div className={row + ' flex-col items-stretch gap-0 px-3 pt-3 pb-3.5'}>
                <div className="flex items-center justify-between gap-2 pl-1">
                  <span className={rowLabel}>Aperçu</span>
                  <div className="flex items-center gap-1.5">
                    <button type="button" aria-label="Semaine précédente" onClick={() => setWeekOffset((o) => o - 1)} className={iconBtn}>
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="min-w-[7.5rem] text-center font-mono text-[10px] tracking-[0.14em] uppercase text-ink/85">
                      {weekOffset === 0 ? 'Cette semaine' : `Sem. du ${formatShortFr(weekDates[0])}`}
                    </span>
                    <button type="button" aria-label="Semaine suivante" onClick={() => setWeekOffset((o) => o + 1)} className={iconBtn}>
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {/* En-tête des jours : lettre + numéro, aujourd'hui en pastille pleine — comme le Planning */}
                <div className={previewGrid + ' mt-2.5 px-1 pb-1'}>
                  <span />
                  {DAY_LETTER.map((letter, d) => {
                    const isToday = d === todayIdx
                    return (
                      <div key={d} title={DAY_NAMES[d]} className="mx-auto flex flex-col items-center gap-0.5">
                        <span className={'font-mono text-[10px] tracking-[0.1em] ' + (isToday ? 'text-sage-500' : 'text-ink/55')}>
                          {letter}
                        </span>
                        <span
                          className={
                            'flex h-5 w-5 items-center justify-center rounded-full font-mono text-[10px] tabular-nums ' +
                            (isToday ? 'bg-sage-500 text-onaccent' : 'text-ink/55')
                          }
                        >
                          {Number(weekDates[d].slice(8, 10))}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="space-y-1" data-preview>
                  {preview.rows.map((r) => (
                    <PreviewRow
                      key={r.session.id}
                      id={r.session.id}
                      title={r.session.name}
                      code={r.code}
                      hex={CATEGORY_META[r.session.category].hex}
                      self={r.self}
                      planned={r.planned}
                      done={r.done}
                      todayIdx={todayIdx}
                    />
                  ))}
                  {/* Courses du plan semi de la semaine, en lecture seule, comme dans le Planning :
                      rond plein sur le jour réellement fait, anneau sur le jour prévu tant que rien n'est fait */}
                  {planStates.map((st) => {
                    const t = TYPE_META[st.seance.type]
                    const inWeek = st.doneDate ? weekDates.indexOf(st.doneDate) : -1
                    const doneCol = !st.done ? -1 : inWeek >= 0 ? inWeek : st.seance.day
                    return (
                      <PreviewRow
                        key={'plan-' + st.seance.day}
                        id={'plan-' + st.seance.day}
                        title={st.seance.title}
                        code={t.code + ' · plan semi'}
                        hex={t.hex}
                        planned={Array.from({ length: 7 }, (_, d) => d === st.seance.day && !st.done)}
                        done={Array.from({ length: 7 }, (_, d) => d === doneCol)}
                        todayIdx={todayIdx}
                      />
                    )
                  })}
                </div>
                {noDays ? (
                  <p className="mt-2.5 pl-1 font-mono text-[9px] leading-relaxed tracking-[0.12em] uppercase text-hiit">
                    Aucun jour choisi : ce programme n'apparaîtra ni dans le Planning ni dans Aujourd'hui.
                  </p>
                ) : (
                  <p className="mt-2.5 pl-1 font-mono text-[9px] tracking-[0.12em] uppercase text-ink/85">
                    Prochaine fois : {preview.nextLabel}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ── Options avancées (repliées derrière leur résumé) ── */}
          <div className={card}>
            <button
              type="button"
              aria-expanded={optionsOpen}
              onClick={() => setOptionsOpen((o) => !o)}
              className="flex min-h-12 w-full items-center gap-3 px-4 text-left"
            >
              <span className={rowLabel}>Options avancées</span>
              {!optionsOpen && <p className="truncate text-[13px] font-semibold text-ink-soft">{optionsSummary}</p>}
              <ChevronDown
                className={'ml-auto h-4 w-4 shrink-0 text-ink-soft/60 transition-transform duration-150 ' + (optionsOpen ? 'rotate-180' : '')}
              />
            </button>
            {optionsOpen && (
              <>
                <div className={row}>
                  <span className={rowLabel}>Section du planning</span>
                  <div className="ml-auto w-full max-w-60">
                    <Combobox
                      small
                      value={group}
                      onChange={setGroup}
                      options={groupSuggestions.map((g) => ({ id: g, label: g }))}
                      onSelect={setGroup}
                      placeholder="Optionnel…"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {hasItems && (
        <aside className="hidden lg:block lg:pt-[4.5rem]">
          {/* Sticky : la banque reste sous les yeux pendant tout le défilement du formulaire */}
          <div className={'sticky top-5 flex max-h-[calc(100dvh-8rem)] flex-col p-4 ' + glassCard}>
            <Eyebrow className="mb-2.5 text-ink/50">— Banque d'exercices</Eyebrow>
            <ExercisePicker
              exercises={catExercises}
              category={category}
              counts={itemCounts}
              onAdd={appendItem}
              onCreate={(d) => void quickCreate(d)}
              searchRef={searchRef}
            />
          </div>
        </aside>
      )}

      <Sheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={category === 'etirements' ? 'Ajouter des postures' : 'Ajouter des exercices'}
      >
        {/* Hauteur bornée : la recherche reste en tête, seule la liste défile */}
        <div className="flex max-h-[62dvh] min-h-[45dvh] flex-col">
          <ExercisePicker
            exercises={catExercises}
            category={category}
            counts={itemCounts}
            onAdd={appendItem}
            onCreate={(d) => void quickCreate(d)}
          />
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen(false)}
          className="mt-4 w-full rounded-sm bg-sage-500 py-3 font-mono text-[11px] font-bold tracking-[0.14em] uppercase text-onaccent"
        >
          Terminé
        </button>
      </Sheet>

      {removed && (
        <div className="fixed inset-x-0 bottom-20 z-50 flex justify-center px-5">
          <div className="flex items-center gap-3 rounded-sm border border-hairline-strong bg-shoal px-4 py-2.5 shadow-xl">
            <p className="max-w-56 truncate text-sm font-semibold text-ink">
              {exOf(removed.item.exerciseId)?.name ?? 'Exercice'} retiré
            </p>
            <button
              type="button"
              onClick={undoRemove}
              className="shrink-0 font-mono text-[11px] font-bold tracking-[0.14em] uppercase text-sage-600"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      <FormActions
        onSave={() => void save()}
        saveDisabled={!name.trim()}
        onDuplicate={existing ? () => void duplicate() : undefined}
        onDelete={existing ? () => void del() : undefined}
      />
    </div>
  )
}
