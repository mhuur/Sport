// Vérification visuelle des formulaires épurés : séance (liste compacte, sélecteur
// d'exercices en Sheet mobile / volet desktop, barre d'action fixe) et exercice
// (sous-types en combobox).
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:5174'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text())
})
page.on('dialog', (d) => d.accept())

try {
  await page.goto(BASE)
  await page.waitForSelector('text=Routine matinale', { timeout: 20000 })

  // --- Fiche séance muscu : liste d'exercices compacte
  await page.getByRole('link', { name: 'Exercices', exact: true }).click()
  await page.waitForSelector('text=Mes programmes')
  await page.click('p:has-text("Muscu — Full body")')
  await page.getByRole('button', { name: 'Modifier', exact: true }).click()
  await page.waitForSelector('text=Planification')
  await page.screenshot({ path: 'screenshots/30-form-seance-haut.png' })
  await page.locator('text=Exercices de la séance').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'screenshots/31-form-seance-exos.png' })

  // --- Sélecteur d'exercices (Sheet mobile) : filtre puis création à la volée
  const addBtn = page.getByRole('button', { name: /Ajouter un exercice/ })
  await addBtn.scrollIntoViewIfNeeded()
  await addBtn.click()
  // Deux pickers dans le DOM (volet desktop masqué en CSS + Sheet) : viser le dialog
  const search = page.locator('[role="dialog"]').getByPlaceholder('Rechercher ou créer…')
  await search.fill('pom')
  await page.waitForSelector('[role="dialog"] button:has-text("Pompes")')
  await page.screenshot({ path: 'screenshots/32-combobox-filtre.png' })
  await search.fill('Dips sur chaise')
  await page.waitForSelector('text=+ Créer « Dips sur chaise »')
  await page.screenshot({ path: 'screenshots/33-combobox-creer.png' })
  await page.click('text=+ Créer « Dips sur chaise »')
  // Mini-ligne de création : nom prérempli, on choisit le sous-type Bras (mesure reps par défaut)
  await page.waitForSelector('[role="dialog"] >> text=Nouvel exercice')
  await page.locator('[role="dialog"] select[aria-label="Sous-type"]').selectOption('Bras')
  await page.click('text=Créer et ajouter')
  await page.click('text=Terminé')
  // Le nom d'item est un simple texte (le select de remplacement a été retiré, août 2026)
  await page.waitForSelector('p:text-is("Dips sur chaise")')

  // --- Séries variées : 3×12 devient 12/12/12 éditables, on passe la 1re à 30
  // Les cartes sont repliées par défaut et se déplient au CLIC (plus de survol, août 2026) :
  // la carte ouverte montre l'édition + les infos de l'exercice (lien démo, fiche)
  await page.locator('div.rounded-md p.truncate').first().click()
  await page.waitForSelector('a[aria-label="Démo"]') // lien démo en icône (sept. 2026)
  await page.locator('[aria-label="Varier les séries"]').first().click()
  await page.screenshot({ path: 'screenshots/38-series-variees.png' })
  const firstCard = page.locator('div.rounded-md').filter({ hasText: 'reps' }).first()
  await firstCard.locator('input[inputmode="numeric"]').nth(1).fill('30')

  // --- Section du planning : suggestions filtrées dans la combobox
  await page.click('text=Options avancées') // section repliée derrière son résumé (sept. 2026)
  const groupBox = page.getByPlaceholder('Optionnel…')
  await groupBox.scrollIntoViewIfNeeded()
  await groupBox.click()
  await page.screenshot({ path: 'screenshots/34-combobox-section.png' })
  await page.keyboard.press('Escape')

  // --- Enregistrer via la barre d'action fixe
  await page.click('text=Enregistrer')
  await page.waitForSelector('text=Mes programmes')
  const d = await page.evaluate(() => JSON.parse(localStorage.getItem('elan-data-v1')))
  const full = d.sessions.find((s) => s.name.includes('Full body'))
  if (!full.items.some((it) => d.exercises.find((e) => e.id === it.exerciseId)?.name === 'Dips sur chaise'))
    throw new Error("L'exercice créé à la volée devrait être dans la séance")
  // La mini-ligne de création classe l'exercice dès sa naissance
  const dips = d.exercises.find((e) => e.name === 'Dips sur chaise')
  if (!(dips?.subtypes ?? []).includes('Bras'))
    throw new Error('Dips sur chaise devrait naître avec le sous-type Bras (mini-ligne du sélecteur)')
  // Les champs retirés du formulaire sont préservés tels quels
  if (full.notes === undefined || full.metrics === undefined || full.links === undefined)
    throw new Error('notes/metrics/links devraient être conservés à la sauvegarde')
  // Les séries variées sont enregistrées (1re série passée à 30)
  if ((full.items[0].targets ?? []).join(',') !== '30,12,12')
    throw new Error(`Les séries variées devraient être 30,12,12 — trouvé ${(full.items[0].targets ?? []).join(',')}`)
  if (full.items.some((it) => 'uid' in it)) throw new Error("L'uid transitoire ne devrait pas être sauvegardé")

  // --- Étirements : blocs disponibles aussi (découpage + tours par bloc)
  await page.click('text=Routine matinale')
  await page.getByRole('button', { name: 'Modifier', exact: true }).click()
  await page.waitForSelector('text=Planification')
  await page.waitForSelector('[title="Tours de la routine"]')
  await page.locator('button:has-text("nouveau bloc")').click()
  await page.waitForSelector('text=Bloc 2')
  await page.click('text=Enregistrer')
  await page.waitForSelector('text=Mes programmes')
  const d2 = await page.evaluate(() => JSON.parse(localStorage.getItem('elan-data-v1')))
  const rout = d2.sessions.find((s) => s.name === 'Routine matinale')
  if (!rout.items[rout.items.length - 1].blockBreak)
    throw new Error('Le dernier étirement devrait démarrer un 2e bloc')
  // La feuille Aujourd'hui montre la routine structurée en blocs
  await page.getByRole('link', { name: "Aujourd'hui" }).click()
  await page.click('text=Routine matinale')
  await page.waitForSelector('text=Bloc 2')
  await page.screenshot({ path: 'screenshots/39-etirements-blocs.png' })
  await page.click('[aria-label="Fermer"]') // la croix ✕ remplace « Fermer sans valider »
  await page.getByRole('link', { name: 'Exercices', exact: true }).click()
  await page.waitForSelector('text=Mes programmes')

  // --- Nouvelle séance : écran épuré
  await page.click('text=+ Programme')
  await page.waitForSelector('text=Nouvelle séance')
  await page.screenshot({ path: 'screenshots/35-form-nouvelle-seance.png' })
  await page.click('[aria-label="Retour"]')

  // --- Fiche exercice : combobox de sous-types
  await page.getByRole('button', { name: "Banque d'exercices", exact: true }).click()
  await page.click('button:has-text("Pompes")')
  await page.waitForSelector("text=Modifier l'exercice")
  await page.screenshot({ path: 'screenshots/36-form-exercice.png' })
  await page.getByPlaceholder('Ajouter un sous-type').fill('tri')
  await page.waitForSelector('text=+ Créer « tri »')
  await page.screenshot({ path: 'screenshots/37-form-exercice-combobox.png' })

  // --- Desktop (≥ lg) : le volet banque est permanent à droite du formulaire,
  //     un clic sur une ligne ajoute l'exercice sans rien fermer
  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  desk.on('pageerror', (e) => errors.push('desktop pageerror: ' + e.message))
  desk.on('console', (m) => {
    if (m.type() === 'error') errors.push('desktop console: ' + m.text())
  })
  await desk.goto(BASE)
  await desk.waitForSelector('text=Routine matinale', { timeout: 20000 })
  await desk.getByRole('link', { name: 'Exercices', exact: true }).click()
  await desk.click('p:has-text("Muscu — Full body")')
  await desk.getByRole('button', { name: 'Modifier', exact: true }).click()
  await desk.waitForSelector('text=Planification')
  await desk.waitForSelector("aside >> text=Banque d'exercices")
  // Compter les poignées : une par carte d'exercice, toujours dans le DOM
  const nBefore = await desk.locator('[aria-label^="Réordonner"]').count()
  // Le premier bouton du volet est désormais le filtre « Tous » : viser un exercice de la liste
  await desk.locator('aside section button').first().click()
  const nAfter = await desk.locator('[aria-label^="Réordonner"]').count()
  if (nAfter !== nBefore + 1)
    throw new Error(`Le clic dans le volet devrait ajouter un exercice (${nBefore} → ${nAfter})`)
  // Le volet est toujours là (il ne se referme pas après un ajout)
  await desk.waitForSelector("aside >> text=Banque d'exercices")
  await desk.screenshot({ path: 'screenshots/40-form-desktop-volet.png' })
  // Sticky : après un long défilement, le panneau reste visible en haut du viewport
  await desk.mouse.wheel(0, 1600)
  await desk.waitForTimeout(300)
  const panel = await desk.locator('aside > div').boundingBox()
  if (!panel || panel.y < 0 || panel.y > 200)
    throw new Error(`Le volet banque devrait rester collé en défilant (y = ${panel?.y})`)
  await desk.close()

  console.log('FORM UI OK — captures 30 à 40 dans ./screenshots')
  if (errors.length) {
    console.error('ERREURS :')
    for (const e of errors) console.error(' -', e)
    process.exitCode = 1
  }
} catch (e) {
  await page.screenshot({ path: 'screenshots/99-echec-form-ui.png' })
  console.error('ÉCHEC :', e.message)
  if (errors.length) for (const er of errors) console.error(' -', er)
  process.exitCode = 1
} finally {
  await browser.close()
}
