import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const base = creds.dev_url || 'http://localhost:5173/'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 950 } })
await p.goto(base); await p.waitForLoadState('networkidle')
await p.click('text=Entrar ou criar conta').catch(()=>{})
await p.waitForSelector('input[type="email"]'); await p.click('text=Acessar')
await p.fill('input[type="email"]', creds.email); await p.fill('input[type="password"]', creds.password)
await p.click('button[type="submit"]'); await p.waitForSelector('.home', { timeout: 25000 })
await p.waitForFunction(() => document.querySelectorAll('.conversation-card').length > 0, { timeout: 20000 })

const cols = await p.evaluate(() => getComputedStyle(document.querySelector('.conversation-list')).gridTemplateColumns.split(' ').length)
console.log('colunas na grade (1600px):', cols)
console.log('cards com prévia:', await p.locator('.conversation-excerpt').count(), 'de', await p.locator('.conversation-card').count())
await p.screenshot({ path: '.test-results/lay-01-home.png' })

await p.locator('.conversation-card').first().click()
await p.waitForSelector('.conversa-head h1')
await p.waitForSelector('.ask-bar')
const box = await p.locator('.ask-bar').boundingBox()
const vh = p.viewportSize().height
console.log('barra de perguntar: y=' + Math.round(box.y) + ' (viewport ' + vh + ')')
await p.screenshot({ path: '.test-results/lay-02-conversa.png' })
await p.mouse.wheel(0, 4000); await p.waitForTimeout(400)
const box2 = await p.locator('.ask-bar').boundingBox()
console.log('depois de rolar até o fim: y=' + Math.round(box2.y))
await p.screenshot({ path: '.test-results/lay-03-rolado.png' })

// pergunta enviada pela barra
await p.fill('.ask-bar textarea', 'Resuma esta conversa em uma frase.')
await p.click('.ask-send')
await p.waitForSelector('.message.user', { timeout: 20000 })
console.log('pergunta chegou no chat:', await p.locator('.message.user .bubble').first().textContent())
console.log('barra fixa some no chat:', await p.locator('.ask-bar').count() === 0)
await p.waitForSelector('.message.assistant .md', { timeout: 60000 })
await p.screenshot({ path: '.test-results/lay-04-chat.png' })

// telas de detalhe também têm a barra
await p.goBack(); await p.waitForSelector('.topic-card')
await p.locator('.topic-card').first().click(); await p.waitForSelector('.conversa-head h1')
console.log('barra presente na tela de tópico:', await p.locator('.ask-bar').count() === 1)

// escuro
await p.goto(base); await p.waitForSelector('.home')
await p.click('.nav-item:has-text("Tema")'); await p.click('.modal .seg button:has-text("Escuro")'); await p.click('.modal .btn-primary')
await p.waitForTimeout(300)
await p.screenshot({ path: '.test-results/lay-05-dark-home.png' })
await p.locator('.conversation-card').first().click(); await p.waitForSelector('.ask-bar')
await p.screenshot({ path: '.test-results/lay-06-dark-conversa.png' })
await p.evaluate(() => localStorage.setItem('dito-theme', 'light'))
await b.close(); console.log('layout ok')
