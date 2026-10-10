/* CoC CS管理 Service Worker — アプリシェルをキャッシュしオフライン起動を可能にする */
const CACHE='coc-cs-v1';
// アプリの中核ファイル（相対パス）。GitHub Pagesが落ちてもここから起動できる
const SHELL=[
  './','./index.html','./sheet.html','./view.html','./status.html',
  './placement.html','./counter.html','./manifest.json',
  './icon-192.png','./icon-512.png','./icon-512-maskable.png',
  // 外部ライブラリ（CDN）: 初回オンライン時にキャッシュ
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];
self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>Promise.allSettled(SHELL.map(u=>c.add(u)))));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('message',e=>{ if(e.data==='skipWaiting')self.skipWaiting(); });

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;                 // 書込(API POST等)は介入しない
  const url=new URL(req.url);
  // Supabase API はキャッシュしない（アプリ側のIndexedDBミラーでオフライン対応）
  if(url.hostname.endsWith('supabase.co'))return;

  const isDoc = req.mode==='navigate' || (req.destination==='document');
  if(isDoc){
    // ページ: ネット優先・失敗時キャッシュ（GitHub落ち対策）→無ければindex
    e.respondWith(
      fetch(req).then(res=>{ const cp=res.clone(); caches.open(CACHE).then(c=>c.put(req,cp)); return res; })
        .catch(()=>caches.match(req).then(r=>r||caches.match('./index.html')))
    );
    return;
  }
  // それ以外(スクリプト/画像/CDN): キャッシュ優先・無ければ取得してキャッシュ
  e.respondWith(
    caches.match(req).then(hit=> hit || fetch(req).then(res=>{
      if(res&&res.status===200){ const cp=res.clone(); caches.open(CACHE).then(c=>c.put(req,cp)); }
      return res;
    }).catch(()=>hit))
  );
});
