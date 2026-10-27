/* RoadSense DriveFusion — vehicle-relative G metrics inspired by SmooDri.
   Keep the phone rigidly mounted. Sensor axes are estimates, not vehicle telemetry. */
(() => {
  'use strict';
  const G = 9.80665;
  const clip = (x,a,b) => Math.max(a,Math.min(b,x));
  const valid = x => typeof x === 'number' && Number.isFinite(x);
  const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const norm = a => Math.hypot(...a);
  const unit = a => { const n=norm(a);return n>1e-6?a.map(v=>v/n):null; };
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const arr = a => a && [a.x,a.y,a.z].every(valid) ? [a.x,a.y,a.z] : null;
  class DrivingMeter {
    constructor(){ this.reset(); }
    reset(){
      this.ready=false;this.gravity=null;this.vertical=null;this.lateral=null;this.forward=null;
      this.smooth=[0,0,0];this.baseline=[0,0,0];this.lastAt=0;this.lastLat=0;
      this.reversals=[];this.lastSign=0;this.score=100;this.violations=0;this.violationHeld=false;
      this.live={ga:0,brake:0,corner:0,shock:0,total:0,lateral:0,longitudinal:0,vertical:0,jerk:0,weaving:false,score:100,violations:0,slope:0};
    }
    calibrate(samples, axis='x', forwardSign=1) {
      const src=samples.filter(a=>a && a.length===3 && a.every(valid));
      if(src.length<8)return false;
      const mean=[0,1,2].map(i=>src.reduce((sum,s)=>sum+s[i],0)/src.length);
      if(norm(mean)<G*.65||norm(mean)>G*1.35)return false;
      const vertical=unit(mean);
      const axisVector=axis==='y'?[0,1,0]:[1,0,0];
      const horizontal=axisVector.map((v,i)=>v-dot(axisVector,vertical)*vertical[i]);
      const lateral=unit(horizontal);
      if(!lateral)return false;
      const forward=unit(cross(vertical,lateral).map(v=>v*forwardSign));
      if(!forward)return false;
      this.reset();this.gravity=mean;this.vertical=vertical;this.lateral=lateral;this.forward=forward;this.ready=true;
      return true;
    }
    process(e, now, settings) {
      if(!this.ready)return null;
      const including=arr(e.accelerationIncludingGravity), linear=arr(e.acceleration);
      if(!including&&!linear)return null;
      const dt=this.lastAt?clip((now-this.lastAt)/1000,.012,.3):.05;
      this.lastAt=now;
      let projected;
      if(including){
        const centered=including.map((v,i)=>v-this.gravity[i]);
        projected=[this.lateral,this.forward,this.vertical].map(ax=>dot(centered,ax)/G);
      }
      if(linear){
        const linProjected=[this.lateral,this.forward,this.vertical].map(ax=>dot(linear,ax)/G);
        projected=projected?projected.map((v,i)=>v*.35+linProjected[i]*.65):linProjected;
      }
      if(!projected)return null;
      // Slow tilt/slope compensation: preserve short maneuvers without treating permanent tilt as braking.
      for(let i=0;i<3;i++){
        const timeConstant=i===2?.9:5;
        this.baseline[i]+=(projected[i]-this.baseline[i])*clip(dt/timeConstant,.002,.1);
        const adjusted=projected[i]-this.baseline[i];
        this.smooth[i]+=(adjusted-this.smooth[i])*(i===2?.43:.23);
      }
      const [lat,lon,vertical]=this.smooth;
      const shock=Math.max(Math.abs(vertical),Math.abs(projected[2]-this.baseline[2]));
      const jerk=Math.abs(lat-this.lastLat)/dt;this.lastLat=lat;
      const maxCorner=Math.max(.04,settings.driveCornerG), maxAccel=Math.max(.04,settings.driveAccelG);
      const maxBrake=Math.max(.04,settings.driveBrakeG), maxShock=Math.max(.08,settings.vibrationThreshold);
      const ga=Math.max(0,lon),brake=Math.max(0,-lon),corner=Math.abs(lat);
      const strongTurn=Math.abs(lat)>maxCorner*.47;
      const sign=strongTurn?Math.sign(lat):0;
      if(sign && this.lastSign && sign!==this.lastSign)this.reversals.push(now);
      if(sign)this.lastSign=sign;
      if(!strongTurn&&Math.abs(lat)<maxCorner*.2)this.lastSign=0;
      this.reversals=this.reversals.filter(t=>now-t<3200);
      const weaving=this.reversals.length>=2||(jerk>settings.driveJerkG&&corner>maxCorner*.65);
      const pct={ga:clip(ga/maxAccel*100,0,150),brake:clip(brake/maxBrake*100,0,150),corner:clip(corner/maxCorner*100,0,150),shock:clip(shock/maxShock*100,0,150)};
      const drivingMax=Math.max(pct.ga,pct.brake,pct.corner), allMax=Math.max(drivingMax,pct.shock);
      const severe=weaving||drivingMax>=100;
      if(severe&&!this.violationHeld){this.violations++;this.violationHeld=true;}
      else if(!severe&&drivingMax<75){this.violationHeld=false;}
      // Road shocks are not counted as bad driving.
      const delta=weaving?-12:drivingMax>=100?-9:drivingMax>=70?-3:settings.scoreRecovery;
      this.score=clip(this.score+delta*dt,0,100);
      this.live={ga,brake,corner,shock,total:Math.hypot(lat,lon),lateral:lat,longitudinal:lon,vertical,
        jerk,weaving,score:this.score,violations:this.violations,pct,
        slope:Math.asin(clip(this.baseline[1],-1,1))*180/Math.PI};
      return this.live;
    }
  }
  window.RoadSenseDriving = new DrivingMeter();
})();
