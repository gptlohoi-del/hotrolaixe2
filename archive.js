/* RoadSense v5 — versioned, append/checkpoint local archive and incremental GitHub sync.
   Never include a GitHub token in a data file, settings snapshot or console output. */
(() => {
  'use strict';
  const REPO = 'gptlohoi-del/RoadSense2';
  const ROOT = 'roadsense-data/v1';
  const APP_VERSION = '5.0.0';
  const FORMAT_VERSION = 1;
  const CHUNK_RECORD_LIMIT = 1100;
  const CHUNK_DURATION_MS = 60000;
  const MAX_JSON_BYTES = 900000;
  const encoder = new TextEncoder();
  const safeNum = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const deepCopy = value => JSON.parse(JSON.stringify(value));
  let database = null, active = null, buffer = [], flushQueue = Promise.resolve();
  let syncBusy = false, onChange = () => {};

  function txn(store, mode, work) {
    return new Promise((resolve, reject) => {
      if (!database) return reject(new Error('IndexedDB chưa sẵn sàng.'));
      let tx;
      try {
        tx = database.transaction(store, mode);
        const source = tx.objectStore(store);
        const request = work(source);
        let result;
        if (request) { request.onsuccess = () => { result = request.result; }; }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('Lỗi ghi bộ nhớ.'));
        tx.onabort = () => reject(tx.error || new Error('Tác vụ IndexedDB bị hủy.'));
      } catch (err) { reject(err); }
    });
  }
  const getAll = store => txn(store, 'readonly', os => os.getAll());
  const get = (store, key) => txn(store, 'readonly', os => os.get(key));
  const put = (store, value) => txn(store, 'readwrite', os => os.put(value));
  const keyOf = (id, index) => `${id}:${String(index).padStart(6, '0')}`;
  const pathOf = (id, index) => `${ROOT}/${id}/part-${String(index).padStart(6,'0')}.json`;
  function uniqueId() {
    if (crypto.randomUUID) return `${Date.now()}-${crypto.randomUUID()}`;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return `${Date.now()}-${[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('')}`;
  }
  function newChunk(meta) {
    return {
      key: keyOf(meta.id, meta.nextChunk), sessionId:meta.id, index:meta.nextChunk,
      sealed:false, uploadedAt:null, payload: {
        schema:'roadsense.raw', schemaVersion:FORMAT_VERSION, appVersion:APP_VERSION,
        sessionId:meta.id, chunkIndex:meta.nextChunk, createdAt:new Date().toISOString(),
        units:{position:'degrees WGS84', accuracy:'m', velocity:'m/s', acceleration:'m/s^2',
          rotationRate:'deg/s (browser)', vibration:'g', timestamp:'ISO UTC and Unix milliseconds'},
        records:[]
      }
    };
  }
  function bytes(value) { return encoder.encode(JSON.stringify(value)).length; }
  async function init(db, callback=()=>{}) {
    database=db; onChange=callback;
    if (!db) throw new Error('Không mở được IndexedDB; không thể ghi hành trình an toàn.');
    // Complete abandoned local chunks after a reload; never delete legacy v4 trips.
    const sessions = await getAll('archiveSessions');
    const chunks = await getAll('archiveChunks');
    for (const chunk of chunks) {
      if (!chunk.sealed) { chunk.sealed=true; await put('archiveChunks', chunk); }
    }
    for (const meta of sessions) {
      if (meta.status==='recording') {
        meta.status='interrupted'; meta.dirty=true;
        await put('archiveSessions',meta);
      }
    }
    onChange();
  }
  async function start(settingsSnapshot, environmentSnapshot={}) {
    if (!database) throw new Error('Bộ nhớ IndexedDB chưa sẵn sàng.');
    if (active) throw new Error('Hành trình đang được ghi.');
    const id=uniqueId();
    const meta={schema:'roadsense.session', schemaVersion:FORMAT_VERSION, appVersion:APP_VERSION,
      id,startedAt:new Date().toISOString(),endedAt:null,status:'recording',
      settingsAtStart:deepCopy(settingsSnapshot),environmentAtStart:deepCopy(environmentSnapshot),
      nextChunk:0,stats:{gps:0,motion:0,events:0,rejectedGps:0},
      dirty:true,syncedAt:null};
    await put('archiveSessions',meta);
    active=meta; buffer=[]; onChange();
    record({kind:'session_started',at:Date.now(),value:{settings:settingsSnapshot}});
    return id;
  }
  function record(entry) {
    if (!active) return;
    buffer.push(deepCopy(entry));
    if (buffer.length >= 250) flush(false).catch(err => {console.warn('Không thể lưu checkpoint:', err.message); onChange();});
  }
  function flush(seal=false) {
    // All local writes are serialized. Data is removed from RAM only after IDB commits.
    const run = async () => {
      if (!active) return;
      if (!buffer.length && !seal) return;
      let chunk=await get('archiveChunks',keyOf(active.id,active.nextChunk));
      if (!chunk) {
        if (!buffer.length) return; // Avoid empty chunks when auto-sync runs with no new samples.
        chunk=newChunk(active);
      }
      const batch=buffer.slice();
      let take=batch.length;
      while(take>0 && bytes({...chunk.payload,records:[...chunk.payload.records,...batch.slice(0,take)]})>MAX_JSON_BYTES) {
        take=Math.floor(take/2);
      }
      if (!take && batch.length) throw new Error('Mẫu cảm biến quá lớn để lưu một tệp dữ liệu.');
      const added=batch.slice(0,take);
      chunk.payload.records.push(...added);
      const now=Date.now();
      const oldStats=active.stats;
      const counts={...oldStats};
      for(const e of added) {
        if(e.kind==='gps') { counts.gps++; if(e.quality!=='ok') counts.rejectedGps++; }
        else if(e.kind==='motion') counts.motion++;
        else counts.events++;
      }
      const shouldSeal=seal || chunk.payload.records.length>=CHUNK_RECORD_LIMIT ||
        now-Date.parse(chunk.payload.createdAt)>=CHUNK_DURATION_MS || bytes(chunk.payload)>780000;
      chunk.sealed=shouldSeal;
      const updated={...active,stats:counts,nextChunk:active.nextChunk+(shouldSeal?1:0),dirty:true};
      await new Promise((resolve,reject)=>{
        const tx=database.transaction(['archiveChunks','archiveSessions'],'readwrite');
        tx.objectStore('archiveChunks').put(chunk);
        tx.objectStore('archiveSessions').put(updated);
        tx.oncomplete=resolve;
        tx.onerror=()=>reject(tx.error || new Error('Không lưu được dữ liệu.'));
        tx.onabort=()=>reject(tx.error || new Error('Ghi dữ liệu bị hủy.'));
      });
      buffer.splice(0,take);
      active=updated;
      onChange();
      if (batch.length > take) await flushPartUntilEmpty(seal);
    };
    flushQueue=flushQueue.catch(()=>{}).then(run);
    return flushQueue;
  }
  async function flushPartUntilEmpty(seal) {
    // Called exclusively inside flushQueue; do not recursively await flush().
    while(buffer.length) {
      let chunk=await get('archiveChunks',keyOf(active.id,active.nextChunk));
      if(!chunk) chunk=newChunk(active);
      let take=Math.min(buffer.length,500);
      while(take>0 && bytes({...chunk.payload,records:[...chunk.payload.records,...buffer.slice(0,take)]})>MAX_JSON_BYTES) take=Math.floor(take/2);
      if(!take) throw new Error('Mẫu dữ liệu vượt giới hạn lưu trữ.');
      const added=buffer.slice(0,take);
      chunk.payload.records.push(...added);
      chunk.sealed=seal || chunk.payload.records.length>=CHUNK_RECORD_LIMIT ||
        Date.now()-Date.parse(chunk.payload.createdAt)>=CHUNK_DURATION_MS || bytes(chunk.payload)>780000;
      const stats={...active.stats};
      for(const e of added) { if(e.kind==='gps'){stats.gps++;if(e.quality!=='ok')stats.rejectedGps++;} else if(e.kind==='motion')stats.motion++; else stats.events++; }
      const next={...active,stats,nextChunk:active.nextChunk+(chunk.sealed?1:0),dirty:true};
      await new Promise((resolve,reject)=>{
        const tx=database.transaction(['archiveChunks','archiveSessions'],'readwrite');
        tx.objectStore('archiveChunks').put(chunk);tx.objectStore('archiveSessions').put(next);
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
      });
      buffer.splice(0,take); active=next;
    }
    onChange();
  }
  async function stop() {
    if (!active) return;
    record({kind:'session_stopped',at:Date.now()});
    await flush(true);
    active={...active,status:'completed',endedAt:new Date().toISOString(),dirty:true};
    await put('archiveSessions',active);
    active=null; buffer=[]; onChange();
  }
  function counts() { return {gps:(active?.stats.gps||0)+buffer.filter(v=>v.kind==='gps').length,
      motion:(active?.stats.motion||0)+buffer.filter(v=>v.kind==='motion').length}; }
  async function stats() {
    const chunks=await getAll('archiveChunks');
    const sessions=await getAll('archiveSessions');
    return {chunks:chunks.length,pending:chunks.filter(x=>x.sealed&&!x.uploadedAt).length,
      sessions:sessions.length,recording:!!active,unsaved:buffer.length};
  }
  function encodeBase64(value) {
    const raw=encoder.encode(value);let latin='';
    for(let i=0;i<raw.length;i+=8192) latin+=String.fromCharCode(...raw.subarray(i,i+8192));
    return btoa(latin);
  }
  function decodeBase64(value) {
    const clean=value.replace(/\s/g,''); const binary=atob(clean);const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function apiPath(path) {return `https://api.github.com/repos/${REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;}
  async function apiFetch(path,token,opts={}) {
    const res=await fetch(apiPath(path),{...opts,headers:{
      'Accept':'application/vnd.github+json','Authorization':`Bearer ${token}`,
      'X-GitHub-Api-Version':'2022-11-28',...(opts.body?{'Content-Type':'application/json'}:{})
    }});
    const data=await res.json().catch(()=>({}));
    return {res,data};
  }
  async function sendFile(path,object,token,overwrite=false) {
    const json=JSON.stringify(object);
    if (encoder.encode(json).length>MAX_JSON_BYTES) throw new Error(`Tệp ${path} quá 900 KB.`);
    let sha;
    if (overwrite) {
      const prev=await apiFetch(path,token);
      if(prev.res.ok) sha=prev.data.sha;
      else if(prev.res.status!==404) throw new Error(`GitHub đọc ${path}: ${prev.res.status} ${prev.data.message||''}`);
    }
    const res=await apiFetch(path,token,{method:'PUT',body:JSON.stringify({
      message:`RoadSense: ${overwrite?'update session':'archive chunk'} ${path.split('/').at(-1)}`,
      content:encodeBase64(json),...(sha?{sha}:{})
    })});
    if (res.res.ok) return {url:res.data.content?.html_url || null,sha:res.data.content?.sha};
    if(!overwrite && (res.res.status===409 || res.res.status===422)) {
      // May be a previous successful upload whose response was lost. Verify byte-for-byte.
      const check=await apiFetch(path,token);
      if(check.res.ok && typeof check.data.content==='string') {
        if(decodeBase64(check.data.content)===json) return {url:check.data.html_url || null,sha:check.data.sha,alreadyExists:true};
        throw new Error(`GitHub đã có tệp khác tên ${path}; không ghi đè dữ liệu cũ.`);
      }
    }
    const hint=[401,403,404].includes(res.res.status)?' Kiểm tra token, quyền Contents: write và repository.':'';
    throw new Error(`GitHub HTTP ${res.res.status}: ${res.data.message || 'Không xác định'}.${hint}`);
  }
  async function sync(token, notify=()=>{}) {
    if(syncBusy) return {skipped:true};
    if(!token) throw new Error('Nhập GitHub Token trước khi đồng bộ.');
    if(!database) throw new Error('IndexedDB chưa sẵn sàng.');
    syncBusy=true;
    let uploaded=0, link=null;
    try {
      if(active) await flush(true); // Take an immutable snapshot; recording continues in next chunk.
      const parts=(await getAll('archiveChunks')).filter(c=>c.sealed&&!c.uploadedAt)
        .sort((a,b)=>a.sessionId.localeCompare(b.sessionId)||a.index-b.index);
      for(const part of parts) {
        notify(`Đang Upload phần ${uploaded+1}/${parts.length}: ${part.sessionId.slice(0,15)}…`);
        const dest=pathOf(part.sessionId,part.index);
        const sent=await sendFile(dest,part.payload,token,false);
        part.uploadedAt=new Date().toISOString();part.gitHubUrl=sent.url;
        await put('archiveChunks',part);
        uploaded++;onChange();
      }
      const sessions=await getAll('archiveSessions');
      for(const original of sessions.filter(s=>s.dirty||!s.syncedAt)) {
        const chunks=(await getAll('archiveChunks')).filter(c=>c.sessionId===original.id);
        const sealed=chunks.filter(c=>c.sealed);
        // A manifest is only marked complete when every local part reached GitHub.
        const allUploaded=sealed.every(c=>!!c.uploadedAt) && sealed.length===chunks.length;
        const manifest={schema:original.schema,schemaVersion:FORMAT_VERSION,appVersion:APP_VERSION,
          id:original.id,startedAt:original.startedAt,endedAt:original.endedAt,
          status:original.status,settingsAtStart:original.settingsAtStart,
          environmentAtStart:original.environmentAtStart||null,
          stats:original.stats,parts:sealed.map(c=>({index:c.index,path:pathOf(c.sessionId,c.index),
            records:c.payload.records.length,uploaded:!!c.uploadedAt})),
          fullySynced:allUploaded,updatedAt:new Date().toISOString()};
        notify(`Đang cập nhật thông tin hành trình ${original.id.slice(0,15)}…`);
        const sent=await sendFile(`${ROOT}/${original.id}/manifest.json`,manifest,token,true);
        link=sent.url||link;
        const current=await get('archiveSessions',original.id);
        if(current && current.nextChunk===original.nextChunk && current.status===original.status &&
          current.stats.gps===original.stats.gps && current.stats.motion===original.stats.motion && current.stats.events===original.stats.events) {
          current.dirty=false;current.syncedAt=new Date().toISOString();
          await put('archiveSessions',current);
          if(active?.id===current.id) active={...active,dirty:false,syncedAt:current.syncedAt};
        }
      }
      onChange();
      return {uploaded,link,repo:REPO};
    } finally {syncBusy=false;}
  }
  async function exportData(legacyTrips=[],roadEvents=[]) {
    if(active) await flush(false);
    return {app:'RoadSense',archiveFormatVersion:FORMAT_VERSION,appVersion:APP_VERSION,
      exportedAt:new Date().toISOString(),sessions:await getAll('archiveSessions'),
      chunks:await getAll('archiveChunks'),legacyV4:{formatVersion:3,trips:legacyTrips,roadEvents}};
  }
  async function exportCsv() {
    if(active) await flush(false);
    const parts=(await getAll('archiveChunks')).sort((a,b)=>a.sessionId.localeCompare(b.sessionId)||a.index-b.index);
    const rows=['session_id,timestamp_utc,latitude,longitude,accuracy_m,altitude_m,heading_deg,speed_mps,quality,processed_speed_kmh'];
    for (const part of parts) for(const r of part.payload.records) if(r.kind==='gps') {
      const g=r.coords||{};
      const values=[part.sessionId,new Date(r.at).toISOString(),g.latitude,g.longitude,g.accuracy,g.altitude,g.heading,g.speed,r.quality,r.speedKmh];
      rows.push(values.map(x=>x===null||x===undefined?'':String(x)).join(','));
    }
    return '\ufeff'+rows.join('\r\n');
  }
  window.RoadSenseArchive={REPO,init,start,record,flush,stop,stats,counts,sync,exportData,exportCsv,
    isRecording:()=>!!active,tokenSafe:'Không lưu token trong dữ liệu hành trình.'};
})();
