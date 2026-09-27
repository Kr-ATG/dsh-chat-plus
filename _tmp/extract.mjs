import { readFileSync } from 'node:fs'
const c = readFileSync('lib/client.js', 'utf8')
const names = ['normalizeUrl','hasQuery','intentDropped','isDefaultLanding','landedUrlOf','navigateDetail']
const out = []
for (const n of names) {
  const i = c.indexOf(`function ${n}(`)
  if (i < 0) { out.push(`function ${n} NOT FOUND`); continue }
  // 抓到大括号配平
  let j = c.indexOf('{', i), depth = 0, k = j
  for (; k < c.length; k++) { if (c[k] === '{') depth++; else if (c[k] === '}') { depth--; if (depth === 0) { k++; break } } }
  out.push(c.slice(i, k))
}
const src = out.join('\n')
const fn = new Function('MAX_SHORT', 'siteOf', 'str3', 'clip', src + '\nreturn { isDefaultLanding, intentDropped, normalizeUrl, navigateDetail };')
const helpers = new Function('s', 'p', `
  const SITES=[[/ctrip\\.com|ly\\.com/,'携程'],[/flights?\\./i,'机票']]
  const HINTS=[[/\\/flight|flightlist|\\/trip|\\/ticket|flights?\\./i,'机票']]
  function siteOf(u){ if(u==null) return undefined; let h='',p=''; try{const x=new URL(u);h=x.hostname.replace(/^www\\./i,'');p=x.pathname}catch{return undefined}
    if(h==='') return undefined
    const s=(SITES.find(([re])=>re.test(h))||[])[1]||h
    const hint=(HINTS.find(([re])=>re.test(h+p))||[])[1]
    return hint===undefined? s : s+' · '+hint }
  function str3(a,...k){ for(const x of k){ const v=a[x]; if(typeof v==='string'&&v.trim()!=='') return v.trim() } return undefined }
  function clip(t,m){ const x=t.replace(/\\s+/g,' ').trim(); return x.length>m?x.slice(0,m-1)+'…':x }
  return { siteOf, str3, clip };
`)(0,0)
const m = fn(20, helpers.siteOf, helpers.str3, helpers.clip)
const req='https://flights.ctrip.com/', land='https://flights.ctrip.com/online/channel/domestic'
console.log('isDefaultLanding(req) =', m.isDefaultLanding(req))
console.log('normalizeUrl(req)     =', m.normalizeUrl(req))
console.log('normalizeUrl(land)    =', m.normalizeUrl(land))
console.log('siteOf(land)          =', helpers.siteOf(land))
console.log('navigateDetail        =', JSON.stringify(m.navigateDetail({ url: req }, '### Page\n- Page URL: ' + land)))
