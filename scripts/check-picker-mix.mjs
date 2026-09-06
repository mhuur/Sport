// Vérifie qu'une séance mêle librement des exercices de plusieurs catégories (06/09/2026,
// demande utilisateur : la catégorie filtre la banque pour chercher, elle ne borne plus la
// séance) :
//  - le sélecteur s'ouvre filtré sur la catégorie de la séance (MUS), « Tous » montre tout ;
//  - filtre ÉTIR → « Chat-vache (dos) » s'ajoute à la séance muscu avec les réglages muscu ;
//  - filtre HIIT → « + Créer » crée l'exercice en HIIT, pas dans la catégorie de la séance ;
//  - changer la catégorie de la séance garde les exercices (réglages remis par défaut).
// Prérequis : `npm run dev:demo` lancé.
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:5174'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 1000 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text())
})
page.on('dialog', (d) => d.accept())

const data = () => page.evaluate(() => JSON.parse(localStorage.getItem('elan-data-v1')))
const dlg = '[role="dialog"]'
const openForm = async () => {
  await page.getByRole('link', { name: 'Exercices', exact: true }).click()
  await page.waitForSelector('text=Mes programmes')
  await page.click('p:has-text("Muscu — Full body")')
  await page.getByRole('button', { name: 'Modifier', exact: true }).click()
  await page.waitForSelector('text=Planification')
}
const openPicker = async () => {
  const addBtn = page.getByRole('button', { name: /Ajouter un exercice/ })
  await addBtn.scrollIntoViewIfNeeded()
  await addBtn.click()
  await page.waitForSelector(`${dlg} button:has-text("Pompes")`)
}

try {
  await page.goto(BASE)
  await page.waitForSelector('text=Routine matinale', { timeout: 20000 })
  await openForm()

  // --- Filtre initial = catégorie de la séance ; « Tous » montre toute la banque
  await openPicker()
  if ((await page.locator(`${dlg} button[aria-label="Muscu"][aria-pressed="true"]`).count()) !== 1) throw new Error('Le sélecteur devrait s\'ouvrir filtré sur la catégorie de la séance (MUS)')
  if ((await page.locator(`${dlg} button:has-text("Chat-vache (dos)")`).count()) > 0) throw new Error('Filtré sur MUS, les étirements ne devraient pas apparaître')
  await page.click(`${dlg} button:has-text("Tous")`)
  await page.waitForSelector(`${dlg} button:has-text("Burpees")`)
  await page.waitForSelector(`${dlg} button:has-text("Chat-vache (dos)")`)
  await page.waitForSelector(`${dlg} button:has-text("Pompes")`)
  await page.screenshot({ path: 'screenshots/mix-01-tous.png' })

  // --- Filtre ÉTIR → un étirement rejoint la séance muscu, avec les réglages muscu (3 × 30 s)
  await page.click(`${dlg} button[aria-label="Étirements"]`)
  await page.waitForSelector(`${dlg} button:has-text("Chat-vache (dos)")`)
  if ((await page.locator(`${dlg} button:has-text("Pompes")`).count()) > 0) throw new Error('Filtré sur ÉTIR, la muscu ne devrait pas apparaître')
  await page.click(`${dlg} button:has-text("Chat-vache (dos)")`)
  await page.screenshot({ path: 'screenshots/mix-02-etirement-ajoute.png' })

  // --- Filtre HIIT → « + Créer » crée l'exercice en HIIT
  await page.click(`${dlg} button[aria-label="HIIT"]`)
  await page.fill(`${dlg} input[aria-label="Rechercher un exercice"]`, 'Corde à sauter')
  await page.click('text=+ Créer « Corde à sauter »')
  await page.waitForSelector(`${dlg} >> text=Nouvel exercice · HIIT`)
  await page.click(`${dlg} button:has-text("Créer et ajouter")`)
  await page.waitForSelector(`${dlg} button:has-text("Corde à sauter")`)
  await page.click(`${dlg} button:has-text("Terminé")`)

  // La liste de la séance porte les deux nouveaux venus, en réglages muscu
  await page.waitForSelector('div.rounded-md p.truncate:text-is("Chat-vache (dos)")')
  await page.waitForSelector('div.rounded-md p.truncate:text-is("Corde à sauter")')
  await page.waitForSelector('text=7 exercices')
  await page.screenshot({ path: 'screenshots/mix-03-liste-mixte.png' })
  await page.click('text=Enregistrer')
  await page.waitForSelector('text=Mes programmes')

  const d1 = await data()
  const corde = d1.exercises.find((e) => e.name === 'Corde à sauter')
  const chat = d1.exercises.find((e) => e.name === 'Chat-vache (dos)')
  const full = d1.sessions.find((s) => s.name === 'Muscu — Full body')
  if (corde?.category !== 'hiit') throw new Error(`« Corde à sauter » devrait être créé en HIIT, trouvé : ${corde?.category}`)
  if (full.category !== 'muscu') throw new Error('La séance devrait rester en muscu')
  const chatItem = full.items.find((it) => it.exerciseId === chat.id)
  if (!chatItem || !full.items.some((it) => it.exerciseId === corde.id)) throw new Error('La séance devrait contenir l\'étirement ET l\'exercice HIIT')
  if (chatItem.sets !== 3 || chatItem.target !== 30) throw new Error(`L'étirement dans une séance muscu devrait avoir 3 × 30 s, trouvé : ${JSON.stringify(chatItem)}`)

  // --- Changer la catégorie de la séance garde les exercices, réglages remis par défaut
  await page.click('p:has-text("Muscu — Full body")')
  await page.getByRole('button', { name: 'Modifier', exact: true }).click()
  await page.waitForSelector('text=Planification')
  await page.click('div:has(> span:text-is("Catégorie")) button[title="Étirements"]')
  await page.waitForSelector('text=Postures de la routine')
  await page.waitForSelector('text=7 postures')
  await page.click('text=Enregistrer')
  await page.waitForSelector('text=Mes programmes')
  const d2 = await data()
  const full2 = d2.sessions.find((s) => s.name === 'Muscu — Full body')
  if (full2.category !== 'etirements' || full2.items.length !== 7) throw new Error(`Après changement de catégorie : ${full2.category}, ${full2.items.length} exercices (7 attendus)`)
  const pompes = full2.items.find((it) => it.exerciseId === d2.exercises.find((e) => e.name === 'Pompes').id)
  if (pompes.sets !== undefined || pompes.target !== 10) throw new Error(`En routine, « Pompes » (reps) devrait passer en 10 reps sans séries, trouvé : ${JSON.stringify(pompes)}`)

  console.log('PICKER-MIX OK — filtre de catégorie dans la banque, séance mixte muscu + étirement + HIIT, création dans la catégorie filtrée, changement de catégorie sans perte')
  if (errors.length) {
    console.error('ERREURS DÉTECTÉES :')
    for (const e of errors) console.error(' -', e)
    process.exitCode = 1
  }
} catch (e) {
  await page.screenshot({ path: 'screenshots/99-echec-picker-mix.png' })
  console.error('ÉCHEC :', e.message)
  if (errors.length) for (const er of errors) console.error(' -', er)
  process.exitCode = 1
} finally {
  await browser.close()
}
