/* ===== CoC CS管理 オフライン層 =====
 * - Service Worker を登録（アプリシェルをキャッシュ→GitHubが落ちても起動可）
 * - キャラデータを IndexedDB にミラー（オフライン閲覧）
 * - オフライン編集を保存＋同期キューに積み、オンライン復帰時に Supabase へ自動反映
 * window.OCO に API を公開。各ページはオンライン成功時に mirror()、
 * 失敗/オフライン時は getList()/getOne()/queueUpsert()/queueDelete() を使う。
 */
(function(){
  'use strict';
  // --- Service Worker 登録 ---
  if('serviceWorker' in navigator){
    window.addEventListener('load',()=>{ navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('SW登録失敗',e)); });
  }

  // --- IndexedDB ---
  const DBNAME='coc_offline', VER=1;
  let _db=null;
  function openDB(){
    return new Promise((res,rej)=>{
      if(_db)return res(_db);
      const r=indexedDB.open(DBNAME,VER);
      r.onupgradeneeded=()=>{
        const db=r.result;
        if(!db.objectStoreNames.contains('chars'))db.createObjectStore('chars',{keyPath:'id'});
        if(!db.objectStoreNames.contains('queue'))db.createObjectStore('queue',{keyPath:'qid',autoIncrement:true});
      };
      r.onsuccess=()=>{_db=r.result;res(_db);};
      r.onerror=()=>rej(r.error);
    });
  }
  function tx(store,mode,fn){
    return openDB().then(db=>new Promise((res,rej)=>{
      const t=db.transaction(store,mode); const s=t.objectStore(store);
      let out; try{ out=fn(s); }catch(e){ rej(e); return; }
      t.oncomplete=()=>res(out); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error);
    }));
  }
  function reqP(r){ return new Promise((res,rej)=>{ r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }

  // --- ミラー（一覧/個別の保存・取得） ---
  // rec: {id,char_name,data,updated_at}
  async function mirrorList(list){
    if(!Array.isArray(list))return;
    await tx('chars','readwrite',s=>{ list.forEach(r=>{ if(r&&r.id)s.put({id:r.id,char_name:r.char_name,data:r.data,updated_at:r.updated_at||new Date().toISOString()}); }); });
  }
  async function mirrorOne(rec){ if(rec&&rec.id) await tx('chars','readwrite',s=>s.put(rec)); }
  async function getList(){
    const out=await tx('chars','readonly',s=>s.getAll ? s.getAll() : null);
    let arr = out && out.then ? await out : await _getAllFallback('chars');
    arr=arr||[]; arr.sort((a,b)=>String(b.updated_at||'').localeCompare(String(a.updated_at||''))); return arr;
  }
  async function getOne(id){ return await tx('chars','readonly',s=>reqP(s.get(id))).then(r=>r); }
  function _getAllFallback(store){ return tx(store,'readonly',s=>reqP(s.getAll())); }
  async function removeOne(id){ await tx('chars','readwrite',s=>s.delete(id)); }

  // --- 同期キュー ---
  // item: {op:'upsert'|'delete', id, char_name, data, user_id, ts}
  async function enqueue(item){ item.ts=Date.now(); await tx('queue','readwrite',s=>s.add(item)); }
  async function queueUpsert(rec,user_id){ await mirrorOne(rec); await enqueue({op:'upsert',id:rec.id,char_name:rec.char_name,data:rec.data,user_id}); }
  async function queueDelete(id,user_id){ await removeOne(id); await enqueue({op:'delete',id,user_id}); }
  async function queueCount(){ const all=await _getAllFallback('queue'); return (all||[]).length; }

  // --- 同期（オンライン時に Supabase へ反映） ---
  let _syncing=false;
  async function flush(db){
    if(_syncing||!navigator.onLine||!db)return {done:0,left:await queueCount()};
    _syncing=true; let done=0;
    try{
      const items=(await _getAllFallback('queue'))||[];
      items.sort((a,b)=>a.ts-b.ts);
      for(const it of items){
        try{
          if(it.op==='delete'){
            if(it.id && !String(it.id).startsWith('local_')) await db.from('character_sheets').delete().eq('id',it.id);
          }else{ // upsert
            if(String(it.id).startsWith('local_')){
              // オフライン新規 → insert して実IDへ付け替え
              const {data:ins,error}=await db.from('character_sheets').insert({user_id:it.user_id,char_name:it.char_name,data:it.data}).select('id').single();
              if(error)throw error;
              if(ins&&ins.id){ const old=await getOne(it.id); if(old){ await mirrorOne({id:ins.id,char_name:it.char_name,data:it.data,updated_at:new Date().toISOString()}); await removeOne(it.id);} window.dispatchEvent(new CustomEvent('oco-idmap',{detail:{from:it.id,to:ins.id}})); }
            }else{
              const {error}=await db.from('character_sheets').update({char_name:it.char_name,data:it.data,updated_at:new Date()}).eq('id',it.id);
              if(error)throw error;
            }
          }
          await tx('queue','readwrite',s=>s.delete(it.qid)); done++;
        }catch(e){ console.warn('同期失敗(後で再試行)',it,e); break; } // 1件失敗したら中断し次回へ
      }
    } finally { _syncing=false; }
    const left=await queueCount();
    window.dispatchEvent(new CustomEvent('oco-synced',{detail:{done,left}}));
    return {done,left};
  }

  function newLocalId(){ return 'local_'+Date.now()+'_'+Math.random().toString(36).slice(2,8); }

  window.OCO={ mirrorList,mirrorOne,getList,getOne,removeOne,queueUpsert,queueDelete,queueCount,flush,newLocalId,
    isOnline:()=>navigator.onLine };
})();
