// Vérifie que la fiche séance ne perd PAS ce qui est en cours quand on ouvre la fiche d'un
// exercice depuis la liste (bug du 05/09/2026 : la navigation démontait le formulaire) :
//  - nom modifié + lundi coché → « Fiche exercice » → Retour → tout est encore là ;
//  - idem en enregistrant la fiche exercice au lieu de revenir ;
//  - le retour de la fiche séance restaurée demande confirmation (elle diffère de l'enregistré) ;
//  - le brouillon ne ressuscite pas à la prochaine ouverture de la même fiche.
// Prérequis : `npm run dev:demo` lancé.
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:5174'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 1000 }, deviceScaleFactor: 2 })
const errors = []
const dialogs = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text())
})
page.on('dialog', (d) => {
  dialogs.push(d.message())
  d.accept()
})

const nameInput = () => page.getByPlaceholder('Ex. HIIT du mardi')
const openForm = async () => {
  await page.getByRole('link', { name: 'Exercices', exact: true }).click()
  await page.waitForSelector('text=Mes programmes')
  await page.click('p:has-text("Muscu — Full body")')
  await page.getByRole('button', { name: 'Modifier', exact: true }).click()
  await page.waitForSelector('text=Planification')
}
const editThenOpenSheet = async (newName) => {
  await nameInput().fill(newName)
  await page.click('button[title="Lundi"]')
  await page.locator('div.rounded-md p.truncate').first().click() // déplie le premier exercice
  await page.click('[aria-label="Fiche exercice"]')
  await page.waitForSelector("text=Modifier l'exercice")
}
const expectRestored = async (newName) => {
  await page.waitForSelector('text=Planification')
  const v = await nameInput().inputValue()
  if (v !== newName) throw new Error(`Au retour, le nom devrait être ${JSON.stringify(newName)}, trouvé ${JSON.stringify(v)}`)
  if ((await page.locator('button[title="Lundi"][aria-pressed="true"]').count()) !== 1) throw new Error('Au retour, le lundi coché devrait être conservé')
}

try {
  await page.goto(BASE)
  await page.waitForSelector('text=Routine matinale', { timeout: 20000 })

  // --- Fiche exercice puis Retour : le brouillon revient
  await openForm()
  await editThenOpenSheet('Muscu — Full body v2')
  await page.click('[aria-label="Retour"]')
  await expectRestored('Muscu — Full body v2')
  await page.screenshot({ path: 'screenshots/draft-01-restaure.png' })

  // Le retour de la fiche restaurée demande confirmation, et l'abandon vide bien le brouillon
  const before = dialogs.length
  await page.click('[aria-label="Retour"]')
  await page.waitForSelector('text=Mes programmes')
  if (dialogs.length !== before + 1 || !/Abandonner/.test(dialogs[dialogs.length - 1])) throw new Error('Le retour d\'une fiche restaurée devrait demander « Abandonner les modifications ? »')
  await page.click('p:has-text("Muscu — Full body")')
  await page.getByRole('button', { name: 'Modifier', exact: true }).click()
  await page.waitForSelector('text=Planification')
  const v0 = await nameInput().inputValue()
  if (v0 !== 'Muscu — Full body') throw new Error(`Après abandon, la fiche devrait repartir de l'enregistré, trouvé ${JSON.stringify(v0)}`)
  await page.click('[aria-label="Retour"]')
  await page.waitForSelector('text=Mes programmes')

  // --- Fiche exercice puis Enregistrer (le cas courant : on corrige l'exercice et on revient)
  await page.click('p:has-text("Muscu — Full body")')
  await page.getByRole('button', { name: 'Modifier', exact: true }).click()
  await page.waitForSelector('text=Planification')
  await editThenOpenSheet('Muscu — Full body v3')
  await page.click('text=Enregistrer')
  await expectRestored('Muscu — Full body v3')
  await page.screenshot({ path: 'screenshots/draft-02-restaure-apres-enregistrer.png' })

  console.log('DRAFT-RESTORE OK — brouillon conservé après la fiche exercice (Retour et Enregistrer), confirmation au retour, pas de résurrection')
  if (errors.length) {
    console.error('ERREURS DÉTECTÉES :')
    for (const e of errors) console.error(' -', e)
    process.exitCode = 1
  }
} catch (e) {
  await page.screenshot({ path: 'screenshots/99-echec-draft.png' })
  console.error('ÉCHEC :', e.message)
  if (errors.length) for (const er of errors) console.error(' -', er)
  process.exitCode = 1
} finally {
  await browser.close()
}
