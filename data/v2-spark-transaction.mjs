// Browser Firestore transaction adapter for the single-family Spark release.
import {canonical,fail,settingsGate,authorize} from './v2-spark-security.mjs';
import {activityEvent} from './v2-spark-activity.mjs';
export const BASE='apps/ramina';
const snapData=s=>s?.exists?.()?s.data():undefined;
export function createSparkWriter(e,clock=()=>new Date()) {
 const path=p=>e.doc(e.db,...`${BASE}/${p}`.split('/'));
 return async function write(request,name,{active=false,readOnly=false,receiptId=null,intent},decide){
  if(!request.auth?.uid)fail('unauthenticated','Firebase anonymous authentication required');
  const operationId=request.data?.operationId;
  if(typeof operationId!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(operationId))fail('invalid-argument','Stable operation UUID required');
  const now=await clock(),key=receiptId??`${request.auth.uid}_${operationId}`,intentKey=canonical({name,intent});
  return e.runTransaction(e.db,async tx=>{
   const [settingsSnap,receiptSnap]=await Promise.all([tx.get(path('settings/v2')),tx.get(path(`ledger/${key}`))]);
   const settings=snapData(settingsSnap),receipt=snapData(receiptSnap),role=authorize(request.auth);
   const today=settingsGate(settings,now,active,{readOnly:readOnly||intent.dryRun===true,writerVersion:request.data?.writerVersion});
   if(receipt){if(receipt.intentKey!==intentKey)fail('already-exists','Operation UUID reused with different intent');return {...receipt.result,replayed:true};}
   const pending=new Map();
   const c={today,now,role,settings,uid:request.auth.uid,operationId,receiptId:key,at:e.serverTimestamp(),
    read:async p=>snapData(await tx.get(path(p))),
    list:async(name,field,value)=>{
      let q=e.collection(e.db,...`${BASE}/${name}`.split('/'));
      if(field)q=e.query(q,e.where(field,'==',value));
      q=e.query(q,e.limit(401));
      // Web transactions cannot atomically query a collection. Discover IDs, then read every
      // discovered document in the transaction. Concurrent edits conflict; phantoms are a documented Spark limit.
      const discovered=await e.getDocs(q);if(discovered.size>400)fail('resource-exhausted','Command exceeds bounded family schedule limit');
      const rows=[];for(const d of discovered.docs){const current=await tx.get(path(`${name}/${d.id}`)),data=snapData(current);if(data&&(!field||data[field]===value))rows.push({...data,id:d.id});}
      return rows;
    },
    set(p,data){pending.set(p,{...(pending.get(p)??{}),...data});}
   };
   const result=await decide(c);
   if(readOnly||intent.dryRun===true){if(pending.size)fail('internal','Read-only command attempted mutation');return result;}
   if(pending.size>450)fail('resource-exhausted','Command too large');
   const activity=await activityEvent(name,intent,result,c,pending);
   if(activity)pending.set(`activity/${key}`,activity);
   const audit={receiptId:key,operationId,actorUid:request.auth.uid};
   for(const [p,data]of pending)tx.set(path(p),{...data,...audit,updatedAt:c.at},{merge:true});
   tx.set(path(`ledger/${key}`),{schemaVersion:2,type:name,actorUid:request.auth.uid,actorRole:'family',writerVersion:request.data.writerVersion,
    operationId,receiptId:key,intentKey,intent,result,createdAt:c.at,changesBalance:pending.has('profile/main'),
    balanceDelta:result.balanceDelta??(result.balanceAfter!==undefined?result.balanceAfter-result.balanceBefore:0),
    ...(result.balanceBefore!==undefined?{balanceBefore:result.balanceBefore,balanceAfter:result.balanceAfter}:{}),
    ...(pending.has('profile/main')?{balanceRevision:pending.get('profile/main').balanceRevision}:{})});
   return result;
  });
 };
}
export async function ensureSparkFirstLaunch(e,clock=()=>new Date()){
 const settings=e.doc(e.db,'apps','ramina','settings','v2'),profile=e.doc(e.db,'apps','ramina','profile','main');
 const today=(await import('./v2-calendar.mjs')).familyToday(await clock());
 const visible=await e.getDoc(settings);
 if(visible.exists()){
  const p=await e.getDoc(profile);
  if(!p.exists())fail('failed-precondition','Incomplete family initialization');
  return {created:false,settings:visible.data()};
 }
 return e.runTransaction(e.db,async tx=>{
  const current=await tx.get(settings);if(current.exists())return {created:false,settings:current.data()};
  const initial={schemaVersion:2,mode:'active',launchKind:'fresh-spark',authMode:'anonymous-family-spark',effectiveDate:today,timeZone:'Asia/Almaty',policyVersion:1,minimumWriterVersion:2};
  tx.set(profile,{balance:0,balanceRevision:0,taskRevision:0,schemaVersion:2});tx.set(settings,initial);
  return {created:true,settings:initial};
 });
}
