import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { desktopBrowser } = await import('./helpers/desktop-browser.mjs');
const browser = desktopBrowser(process.env.RD_CHROME);
const session = await browser.sessionPromise;
const send = (m, p = {}) => browser.cdp.send(m, p, session);
await send('Page.enable');
await send('Page.navigate', { url: pathToFileURL(path.resolve(here, '../../.rd/demo/02-dfmea.html')).href + '?theme=light' });
await new Promise(r => setTimeout(r, 3000));
const r = await send('Runtime.evaluate', { expression: `(() => {
  const card = document.querySelector('.card');
  if (!card) return { error: 'no card element' };
  const cs = getComputedStyle(card);
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    preset: document.documentElement.getAttribute('data-preset'),
    cardBg: cs.backgroundColor,
    cardImage: cs.backgroundImage ? cs.backgroundImage.slice(0, 80) : 'none',
    h3Color: card.querySelector('h3') ? getComputedStyle(card.querySelector('h3')).color : 'n/a',
    liColor: card.querySelector('li') ? getComputedStyle(card.querySelector('li')).color : 'n/a',
    panelVar: getComputedStyle(document.documentElement).getPropertyValue('--panel').trim(),
  };
})()`, returnByValue: true });
console.log(JSON.stringify(r.result.value, null, 1));
await browser.close();
