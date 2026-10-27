/* Durable road-hazard memory in the existing RoadSenseDB; no 300-event truncation.
   Aggregates nearby shock reports; different trips increase confirmation confidence. */
(() => {
  'use strict';
  const rad=v=>v*Math.PI/180;
  const dist=(a,b)=>{
    const dLat=rad(a.lat-b.lat),dLon=rad(a.lng-b.lng),p1=rad(a.lat),p2=rad(b.lat);
    return 12742000*Math.asin(Math.min(1,Math.sqrt(Math.sin(dLat/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dLon/2)**2)));
  };
  const bearing=(a,b)=>{const d=rad(b.lng-a.lng),a1=rad(a.lat),a2=rad(b.lat);return(Math.atan2(Math.sin(d)*Math.cos(a2),Math.cos(a1)*Math.sin(a2)-Math.sin(a1)*Math.cos(a2)*Math.cos(d))*180/Math.PI+360)%360;};
  const difference=(a,b)=>Math.abs(((a-b+540)%360)-180);
  const okay=x=>typeof x==='number'&&Number.isFinite(x);
  const id=()=>globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const bucketKey=(lat,lng)=>`${Math.floor(lat*1000)}:${Math.floor(lng*1000)}`;
  const neighbors=(lat,lng)=>{
    const a=Math.floor(lat*1000),b=Math.floor(lng*1000),out=[];
    for(let i=-2;i<=2;i++)for(let j=-2;j<=2;j++)out.push(`${a+i}:${b+j}`);
    return out;
  };
  class RoadMemory {
    constructor(){this.db=null;this.points=[];this.index=new Map();this.pending=Promise.resolve();this.lastSaveError='';}
    _reindex(){
      this.index.clear();
      this.points.forEach(p=>{const k=bucketKey(p.lat,p.lng);if(!this.index.has(k))this.index.set(k,[]);this.index.get(k).push(p);});
    }
    _near(loc){return neighbors(loc.lat,loc.lng).flatMap(k=>this.index.get(k)||[]);}
    _put(point){return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('roadPoints','readwrite');
      tx.objectStore('roadPoints').put({...point});
      tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||Error('Lỗi ghi điểm xóc'));
      tx.onabort=()=>reject(tx.error||Error('Giao dịch ghi điểm xóc bị hủy'));
    });}
    async init(db,legacy=[]){
      this.db=db;
      this.points=await new Promise((resolve,reject)=>{
        const req=db.transaction('roadPoints').objectStore('roadPoints').getAll();
        req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);
      });
      this._reindex();
      // Legacy localStorage collection might contain points not yet migrated.
      const marker='roadsense_memory_migrated_v1';
      if(!localStorage.getItem(marker)){
        for(const old of Array.isArray(legacy)?legacy:[]){
          if(!okay(old.lat)||!okay(old.lng)||!okay(old.at))continue;
          await this.record({...old,source:'legacy'},'legacy',true);
        }
        try{localStorage.setItem(marker,'1');}catch{}
      }
      return this.points.length;
    }
    async record(input,tripId,fromImport=false){
      if(!this.db||!okay(input.lat)||!okay(input.lng)||!okay(input.shockG))return null;
      // Prefer reliable GPS fixes for learning; legacy location accuracy can be unknown.
      if(!fromImport&&(!okay(input.accuracyM)||input.accuracyM>45))return null;
      const now=okay(input.at)?input.at:Date.now();
      const nearby=this._near(input).filter(p=>dist(p,input)<=Math.max(12,Math.min(28,(p.accuracyM||15)+(input.accuracyM||15))));
      nearby.sort((a,b)=>dist(a,input)-dist(b,input));
      let point=nearby[0];
      const visit=String(tripId||'unknown');
      if(point){
        const prevCount=point.observations||1;
        const already=(point.tripIds||[]).includes(visit);
        // Keep count bounded per session; capture multi-trip repetitions only.
        if(!already){point.observations=prevCount+1;point.tripIds=[...(point.tripIds||[]),visit].slice(-50);}
        point.shockG=Math.round(Math.max(point.shockG,input.shockG)*1000)/1000;
        point.lat=(point.lat*prevCount+input.lat)/(prevCount+1);
        point.lng=(point.lng*prevCount+input.lng)/(prevCount+1);
        point.lastSeenAt=Math.max(point.lastSeenAt||0,now);
        point.accuracyM=Math.min(point.accuracyM||99,input.accuracyM||99);
      } else {
        point={id:id(),lat:input.lat,lng:input.lng,at:now,lastSeenAt:now,
          shockG:Math.round(input.shockG*1000)/1000,accuracyM:input.accuracyM||null,
          observations:1,tripIds:[visit],source:input.source||'sensor'};
        this.points.push(point);
      }
      this._reindex();
      const snapshot={...point,tripIds:[...point.tripIds]};
      // Write sequentially, so rapid sensor events don't race/corrupt IDB.
      const task=this.pending.catch(()=>{}).then(()=>this._put(snapshot));
      this.pending=task;
      try {await task;this.lastSaveError='';}catch(e){this.lastSaveError=e.message;throw e;}
      return point;
    }
    upcoming(fix,heading,speed,radius){
      if(!fix||!okay(fix.lat)||!okay(fix.lng))return null;
      const pool=radius<=120?this._near(fix):this.points;
      let best=null;
      for(const p of pool){
        if(Date.now()-(p.lastSeenAt||p.at)<60000)continue;
        const distance=dist(fix,p);
        if(distance<Math.max(12,(fix.accuracy||0)*.5)||distance>radius)continue;
        if(okay(heading)&&okay(speed)&&speed>5&&difference(bearing(fix,p),heading)>60)continue;
        if(!best||distance<best.distance)best={event:p,distance};
      }
      return best;
    }
    async importData(data){
      const collection=Array.isArray(data)?data:Array.isArray(data?.roadPoints)?data.roadPoints:Array.isArray(data?.roadEvents)?data.roadEvents:Array.isArray(data?.legacyV4?.roadEvents)?data.legacyV4.roadEvents:[];
      let accepted=0;
      for(const p of collection){
        if(!okay(p.lat)||!okay(p.lng)||!okay(p.shockG)||Math.abs(p.lat)>90||Math.abs(p.lng)>180)continue;
        await this.record({...p,at:p.lastSeenAt||p.at||Date.now(),accuracyM:p.accuracyM||null},`import-${p.id||p.at||accepted}`,true);
        accepted++;
      }
      return accepted;
    }
    stats(){return{count:this.points.length,confirmed:this.points.filter(p=>(p.observations||1)>=2).length,saveError:this.lastSaveError};}
  }
  window.RoadSenseMemory=new RoadMemory();
})();
