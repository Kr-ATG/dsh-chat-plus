import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dsh-chat-plus')
const code = readFileSync(resolve(ROOT, 'lib/client.js'), 'utf8')
const registrations = []
const stubNode = (tag='div') => ({ nodeType:1, tagName:String(tag).toUpperCase(), style:{}, dataset:{}, classList:{add(){},remove(){},toggle(){},contains(){return false}}, children:[], childNodes:[], appendChild(){}, remove(){}, setAttribute(){}, getAttribute(){return null}, removeAttribute(){}, addEventListener(){}, removeEventListener(){}, set textContent(v){this._t=v}, get textContent(){return this._t??''} })
const sandbox = {
  __ModuleLoader__: { load: (e) => registrations.push(e) },
  document: { head: stubNode('head'), body: stubNode('body'), documentElement: stubNode('html'), createElement: (t)=>stubNode(t), createTextNode: (t)=>({nodeType:3,textContent:t}), querySelector:()=>null, querySelectorAll:()=>[], getElementById:()=>null, getElementsByTagName:()=>[], addEventListener:()=>{}, removeEventListener:()=>{} },
  console, setTimeout:()=>0, clearTimeout:()=>{}, setInterval:()=>0, clearInterval:()=>{}, queueMicrotask:(f)=>f(),
  window: { innerWidth: 1280, innerHeight: 800, addEventListener:()=>{}, removeEventListener:()=>{}, matchMedia:()=>({matches:false, addEventListener:()=>{}}), requestAnimationFrame:()=>0 },
  navigator: { userAgent: 'node' }, location: { href: 'http://x/', hash: '' },
  fetch: async () => ({ ok: true, text: async () => '{}' }),
  ResizeObserver: class { observe(){} disconnect(){} },
}
sandbox.window.__ModuleLoader__ = sandbox.__ModuleLoader__; sandbox.self = sandbox; sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(code, sandbox)
const stub = (p) => new Proxy(function(){}, { get: ()=>stub, apply: ()=>stub, construct: ()=>stub })
const MODULES = {
  react: { memo:(c)=>c, useState:()=>[undefined,()=>{}], useEffect:()=>{}, useMemo:(f)=>f(), useRef:()=>({current:undefined}), useCallback:(f)=>f, useSyncExternalStore:()=>undefined, Fragment:'F' },
  'react/jsx-runtime': { jsx:(t,p)=>({t,p}), Fragment:'F' },
  'react-dom': { createPortal:(n)=>n },
  'react-dom/client': { createRoot:()=>({render(){},unmount(){}}) },
}
const entry = registrations[0]
const mod = entry.factory((id)=> id in MODULES ? MODULES[id] : new Proxy({}, { get:()=>stub, has:()=>true }))
const req = 'https://flights.ctrip.com/'
const land = 'https://flights.ctrip.com/online/channel/domestic'
const s = mod.toPlainStep({ toolName:'browser_navigate', args:{url:req}, status:'done', resultText:`### Page\n- Page URL: ${land}` })
console.log('detail =', JSON.stringify(s.detail))
console.log('siteOf(req) =', JSON.stringify(mod.siteOf(req)))
console.log('siteOf(land) =', JSON.stringify(mod.siteOf(land)))
console.log('isDefaultLanding exported?', typeof mod.isDefaultLanding)


