/* シナリオエディタ オフライン用 Service Worker
   index.html と同じ場所（同一フォルダ）に置いてください。
   更新時は下の CACHE のバージョン番号を上げると確実に新しい内容へ切り替わります。 */
var CACHE  = 'scenario-editor-v1';
var PREFIX = 'scenario-editor-';

self.addEventListener('install', function(e){ self.skipWaiting(); });

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if(k.indexOf(PREFIX)===0 && k!==CACHE) return caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;
  var url;
  try{ url = new URL(req.url); }catch(_){ return; }

  // GitHub同期系（Gist/API）はキャッシュせず常にネットワークへ（オフライン時はアプリ側で失敗を処理）
  if(url.hostname === 'api.github.com' || /githubusercontent\.com$/.test(url.hostname)) return;

  var isHTML = (req.mode === 'navigate') || ((req.headers.get('accept')||'').indexOf('text/html') >= 0);

  if(isHTML){
    // アプリ本体(HTML)はネットワーク優先：オンライン時は常に最新を取得し、取れた版をキャッシュ。オフライン時はキャッシュを返す
    e.respondWith(
      fetch(req).then(function(res){
        try{ var copy = res.clone(); caches.open(CACHE).then(function(c){ c.put(req, copy); }); }catch(_){}
        return res;
      }).catch(function(){
        return caches.match(req).then(function(c){ return c || caches.match('./') || caches.match('index.html'); });
      })
    );
    return;
  }

  // フォント・ライブラリ等の静的リソースはキャッシュ優先（初回オンライン時に取得・保存→以後オフラインでも利用可）
  e.respondWith(
    caches.match(req).then(function(cached){
      if(cached) return cached;
      return fetch(req).then(function(res){
        try{
          if(res && (res.status === 200 || res.type === 'opaque')){
            var copy = res.clone();
            caches.open(CACHE).then(function(c){ c.put(req, copy); });
          }
        }catch(_){}
        return res;
      }).catch(function(){ return cached; });
    })
  );
});
