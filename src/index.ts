import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';

type Phase={id:string;green:number;yellow:number;red:number}; type Intersection={id:string;name:string;phases:Phase[];cycle:number;queues:Record<string,number>;capacity:number;offset?:number};
const app=Fastify({logger:true}); const now=()=>new Date().toISOString();
const intersections:Intersection[]=[
{id:'J-01',name:'人民路/中山路',phases:[{id:'NS',green:38,yellow:3,red:39},{id:'EW',green:32,yellow:3,red:45}],cycle:80,queues:{N:12,S:8,E:15,W:11},capacity:42},
{id:'J-02',name:'中山路/解放路',phases:[{id:'NS',green:30,yellow:3,red:37},{id:'EW',green:30,yellow:3,red:37}],cycle:70,queues:{N:9,S:12,E:18,W:10},capacity:36},
{id:'J-03',name:'解放路/滨江路',phases:[{id:'NS',green:28,yellow:3,red:35},{id:'EW',green:28,yellow:3,red:35}],cycle:66,queues:{N:7,S:5,E:13,W:9},capacity:34}
];
const detectors:any[]=[];const incidents:any[]=[];const plans:any[]=[];const runs:any[]=[];const audit:any[]=[];
const log=(action:string,payload:any)=>audit.push({id:randomUUID(),time:now(),action,payload});
function simulate(input:any){
 let totalDelay=0,maxQueue=0,spillbacks=0; const snapshots:any[]=[]; const horizon=Number(input.horizon||900); const demand=input.demand||{};
 const queues:Record<string,Record<string,number>>=Object.fromEntries(intersections.map(j=>[j.id,{...j.queues}]));
 for(let tick=0;tick<horizon;tick+=5){
  for(const j of intersections){
   const d=Number(demand[j.id]??(j.capacity*.72)); const greenRatio=j.phases[0].green/j.cycle; const served=d*greenRatio*.18; const blocked=incidents.some(x=>x.status==='active'&&x.intersectionId===j.id)?.55:1;
   for(const lane of Object.keys(queues[j.id])){const arrival=d*.04*(lane==='E'||lane==='W'?1.05:.95); queues[j.id][lane]=Math.max(0,queues[j.id][lane]+arrival-served*blocked/4); if(queues[j.id][lane]>j.capacity){spillbacks++;queues[j.id][lane]=j.capacity*1.15;}}
   totalDelay+=Object.values(queues[j.id]).reduce((a,b)=>a+b,0)*5; maxQueue=Math.max(maxQueue,...Object.values(queues[j.id]));
  }
  if(tick%60===0)snapshots.push({second:tick,queues:intersections.map(j=>({id:j.id,...queues[j.id]}))});
 }
 return{horizon,totalDelay:Number(totalDelay.toFixed(1)),maxQueue:Number(maxQueue.toFixed(1)),spillbacks,averageSpeed:Number(Math.max(8,42-totalDelay/(horizon*10)).toFixed(2)),snapshots};
}
app.get('/health',async()=>({ok:true,service:'urban-traffic-signal-simulation',time:now()}));
app.get('/api/network/state',async()=>({at:now(),intersections,incidents,detectors,metrics:{averageSpeed:31.4,totalQueue:intersections.reduce((s,j)=>s+Object.values(j.queues).reduce((a,b)=>a+Number(b),0),0)}}));
app.post('/api/detectors/events',async(req:any,res)=>{const b=req.body as any;if(!b.detectorId||b.flow==null)return res.code(400).send({error:'detectorId 和 flow 必填'});const e={id:randomUUID(),time:b.time||now(),detectorId:b.detectorId,flow:Number(b.flow),occupancy:Number(b.occupancy||0),speed:Number(b.speed||0)};detectors.push(e);return e;});
app.post('/api/incidents',async(req:any,res)=>{const b=req.body as any;if(!b.intersectionId||!b.type)return res.code(400).send({error:'intersectionId 和 type 必填'});const i={id:randomUUID(),intersectionId:b.intersectionId,type:b.type,lane:b.lane||'unknown',severity:b.severity||'medium',status:'active',startedAt:now(),estimatedClearMinutes:Number(b.estimatedClearMinutes||20)};incidents.push(i);log('incident.open',i);return i;});
app.post('/api/incidents/:id/clear',async(req:any,res)=>{const i=incidents.find(x=>x.id===(req.params as any).id);if(!i)return res.code(404).send({error:'incident not found'});i.status='cleared';i.clearedAt=now();return i;});
app.post('/api/plans',async(req:any,res)=>{const b=req.body as any;if(!b.name||!b.changes)return res.code(400).send({error:'name 和 changes 必填'});const p={id:randomUUID(),name:b.name,basePlan:intersections.map(j=>({id:j.id,cycle:j.cycle,phases:j.phases})),changes:b.changes,priority:b.priority||'normal',status:'draft',createdAt:now()};plans.push(p);return p;});
app.post('/api/plans/:id/validate',async(req:any,res)=>{const p=plans.find(x=>x.id===(req.params as any).id);if(!p)return res.code(404).send({error:'plan not found'});const errors:string[]=[];for(const [id,change] of Object.entries(p.changes as Record<string,any>)){const j=intersections.find(x=>x.id===id);if(!j)errors.push(`${id}: intersection not found`);else{const cycle=Number((change as any).cycle??j.cycle);const phases=(change as any).phases||j.phases;if(cycle<30||cycle>180)errors.push(`${id}: cycle out of [30,180]`);if(phases.reduce((s:any,x:any)=>s+Number(x.green||0)+Number(x.yellow||0),0)>cycle)errors.push(`${id}: phase budget exceeded`);}}p.validation={valid:errors.length===0,errors};return p;});
app.post('/api/plans/:id/apply',async(req:any,res)=>{const p=plans.find(x=>x.id===(req.params as any).id);if(!p)return res.code(404).send({error:'plan not found'});if(!p.validation?.valid)return res.code(409).send({error:'plan must pass validation',validation:p.validation});for(const [id,change] of Object.entries(p.changes as Record<string,any>)){const j=intersections.find(x=>x.id===id);if(j){j.cycle=Number((change as any).cycle??j.cycle);if((change as any).phases)j.phases=(change as any).phases;}}p.status='applied';p.appliedAt=now();log('plan.apply',p);return p;});
app.post('/api/simulations',async(req:any,res)=>{const b=req.body as any;const plan=b.planId?plans.find(x=>x.id===b.planId):null;if(b.planId&&!plan)return res.code(404).send({error:'plan not found'});const baseline=simulate({horizon:b.horizon,demand:b.demand});let candidate=null;if(plan){const saved=intersections.map(j=>({j,cycle:j.cycle,phases:j.phases}));for(const [id,c] of Object.entries(plan.changes as Record<string,any>)){const j=intersections.find(x=>x.id===id);if(j){j.cycle=Number((c as any).cycle??j.cycle);if((c as any).phases)j.phases=(c as any).phases}}candidate=simulate({horizon:b.horizon,demand:b.demand});saved.forEach(x=>{x.j.cycle=x.cycle;x.j.phases=x.phases});}const r={id:randomUUID(),createdAt:now(),planId:b.planId||null,baseline,candidate,delta:candidate?{delay:Number((candidate.totalDelay-baseline.totalDelay).toFixed(1)),maxQueue:Number((candidate.maxQueue-baseline.maxQueue).toFixed(1)),speed:Number((candidate.averageSpeed-baseline.averageSpeed).toFixed(2))}:null};runs.push(r);return r;});
app.post('/api/optimization',async(req:any)=>{
 const b=req.body as any;
 const options=[{cycleBias:-8,greenShift:4},{cycleBias:0,greenShift:0},{cycleBias:10,greenShift:-3}].map((o,i)=>{
  const changes:any={};
  for(const j of intersections) changes[j.id]={cycle:Math.max(30,Math.min(180,j.cycle+o.cycleBias)),phases:j.phases.map((phase,k)=>({...phase,green:Math.max(10,phase.green+(k===0?o.greenShift:-o.greenShift))}))};
  return {id:randomUUID(),label:`候选方案 ${i+1}`,changes,result:simulate({horizon:b.horizon||600,demand:b.demand})};
 });
 options.sort((a,b)=>a.result.totalDelay-b.result.totalDelay);
 return {objective:b.objective||'minimize-delay',candidates:options,best:options[0]};
});
app.get('/api/simulations/:id',async(req:any,res)=>{const r=runs.find(x=>x.id===(req.params as any).id);if(!r)return res.code(404).send({error:'simulation not found'});return r;});
app.get('/api/audit',async()=>audit.slice(-100));

// Advanced operations: corridor coordination, transit priority, pedestrian safety and emissions.
const priorityRequests:any[]=[]; const corridors:any[]=[{id:'C-01',name:'中山路绿波走廊',intersectionIds:['J-01','J-02','J-03'],lengthMeters:2400,targetSpeedKph:36}]; const scenarioPolicies:any[]=[];

// === 优先请求 × 行人安全 统一决策流程 ===
// 决策顺序（每一步都产出可解释原因）：
// 1. ETA 有效性：ETA<0 或非数字 -> 拒绝（过期 ETA，车辆已应到达/驶过）
// 2. 重复提交：同路口/线路/请求类型在窗口内已有未终结请求 -> 拒绝
// 3. 行人安全约束：读取该路口最新已验证行人相位，requiredClearance=crossingSeconds+leadingInterval
//    - ETA 不足以安全清空行人相位：应急 -> 拒绝（禁止以行人安全为代价抢占）；公交 -> 延后
// 4. 约束满足或无行人策略：保留既有规则（应急批准；公交按乘客量 >=20 批准，否则延后）
type PriorityRequestType='transit'|'emergency';
type PriorityStatus='approved'|'deferred'|'rejected';
type PriorityReasonCode='eta-expired'|'duplicate-request'|'pedestrian-safety-conflict'|'pedestrian-clearance-pending'|'low-occupancy'|'high-occupancy'|'emergency-priority';
type PedestrianConstraint={hasPolicy:boolean;constraint:'none'|'satisfied'|'insufficient';policyId?:string;crossingSeconds?:number;leadingInterval?:number;requiredClearance?:number;availableEta?:number;shortfallSeconds?:number};
type PriorityDecision={status:PriorityStatus;approved:boolean;reasonCode:PriorityReasonCode;reason:string;etaSeconds:number;duplicateOf?:string;pedestrian:PedestrianConstraint|null;evaluatedAt:string};
const DUPLICATE_WINDOW_SECONDS=120;
const latestPedestrianPolicy=(intersectionId:string):any=>{
 for(let i=scenarioPolicies.length-1;i>=0;i--){const p=scenarioPolicies[i];if(p.intersectionId===intersectionId&&p.status==='validated')return p;}
 return undefined;
};
const findDuplicatePriorityRequest=(input:{intersectionId:string;routeId:string;requestType:string},atMs:number)=>
 priorityRequests.find(r=>r.intersectionId===input.intersectionId&&r.routeId===input.routeId&&r.requestType===input.requestType&&r.status!=='rejected'&&(atMs-new Date(r.requestedAt).getTime())/1000<=DUPLICATE_WINDOW_SECONDS);
function decidePriorityRequest(input:{intersectionId:string;routeId:string;etaSeconds:number;passengers:number;requestType:PriorityRequestType},atIso:string):PriorityDecision{
 const atMs=new Date(atIso).getTime();
 // 1) 过期 / 非法 ETA
 if(!Number.isFinite(input.etaSeconds)||input.etaSeconds<0){
  return {status:'rejected',approved:false,reasonCode:'eta-expired',reason:`ETA ${input.etaSeconds}s 已过期或无效，车辆预计到达时刻已过，无法再安排信号优先`,etaSeconds:input.etaSeconds,pedestrian:null,evaluatedAt:atIso};
 }
 // 2) 重复提交（已拒绝的失败请求不占用窗口，允许修正后重提）
 const duplicate=findDuplicatePriorityRequest(input,atMs);
 if(duplicate){
  return {status:'rejected',approved:false,reasonCode:'duplicate-request',reason:`该${input.requestType==='emergency'?'应急':'公交'}请求与 ${duplicate.id}（状态 ${duplicate.status}）重复，${DUPLICATE_WINDOW_SECONDS}s 窗口内请勿重复提交`,etaSeconds:input.etaSeconds,duplicateOf:duplicate.id,pedestrian:null,evaluatedAt:atIso};
 }
 // 3) 当前行人过街约束
 const policy=latestPedestrianPolicy(input.intersectionId);
 if(policy){
  const requiredClearance=Number(policy.crossingSeconds)+Number(policy.leadingInterval);
  if(input.etaSeconds<requiredClearance){
   const shortfall=requiredClearance-input.etaSeconds;
   const pedestrian:PedestrianConstraint={hasPolicy:true,constraint:'insufficient',policyId:policy.id,crossingSeconds:policy.crossingSeconds,leadingInterval:policy.leadingInterval,requiredClearance,availableEta:input.etaSeconds,shortfallSeconds:shortfall};
   if(input.requestType==='emergency'){
    return {status:'rejected',approved:false,reasonCode:'pedestrian-safety-conflict',reason:`应急车辆 ETA ${input.etaSeconds}s 小于行人安全清空时间 ${requiredClearance}s（过街 ${policy.crossingSeconds}s + 前置引导 ${policy.leadingInterval}s，缺口 ${shortfall}s），不足以安全中止行人相位，禁止抢占`,etaSeconds:input.etaSeconds,pedestrian,evaluatedAt:atIso};
   }
   return {status:'deferred',approved:false,reasonCode:'pedestrian-clearance-pending',reason:`ETA ${input.etaSeconds}s 小于行人安全清空时间 ${requiredClearance}s（缺口 ${shortfall}s），延后至行人相位安全结束后再授予优先`,etaSeconds:input.etaSeconds,pedestrian,evaluatedAt:atIso};
  }
  const pedestrian:PedestrianConstraint={hasPolicy:true,constraint:'satisfied',policyId:policy.id,crossingSeconds:policy.crossingSeconds,leadingInterval:policy.leadingInterval,requiredClearance,availableEta:input.etaSeconds};
  // 4a) 行人约束满足：沿用既有类型/乘客量规则
  if(input.requestType==='emergency')return {status:'approved',approved:true,reasonCode:'emergency-priority',reason:`应急请求，ETA ${input.etaSeconds}s 可满足行人安全清空时间 ${requiredClearance}s，批准优先放行`,etaSeconds:input.etaSeconds,pedestrian,evaluatedAt:atIso};
  if(input.passengers>=20)return {status:'approved',approved:true,reasonCode:'high-occupancy',reason:`公交载客 ${input.passengers} 人（≥20），且行人安全清空时间 ${requiredClearance}s 可满足，批准优先`,etaSeconds:input.etaSeconds,pedestrian,evaluatedAt:atIso};
  return {status:'deferred',approved:false,reasonCode:'low-occupancy',reason:`公交载客 ${input.passengers} 人（<20），行人约束虽已满足，按既有规则延后至常规排队`,etaSeconds:input.etaSeconds,pedestrian,evaluatedAt:atIso};
 }
 // 4b) 无已验证行人策略：不施加过街约束，沿用既有类型/乘客量规则
 if(input.requestType==='emergency')return {status:'approved',approved:true,reasonCode:'emergency-priority',reason:'该路口无已验证行人过街策略，应急请求直接批准优先放行',etaSeconds:input.etaSeconds,pedestrian:{hasPolicy:false,constraint:'none'},evaluatedAt:atIso};
 if(input.passengers>=20)return {status:'approved',approved:true,reasonCode:'high-occupancy',reason:`该路口无已验证行人过街策略，公交载客 ${input.passengers} 人（≥20），按既有规则批准优先`,etaSeconds:input.etaSeconds,pedestrian:{hasPolicy:false,constraint:'none'},evaluatedAt:atIso};
 return {status:'deferred',approved:false,reasonCode:'low-occupancy',reason:`该路口无已验证行人过街策略，公交载客 ${input.passengers} 人（<20），按既有规则延后`,etaSeconds:input.etaSeconds,pedestrian:{hasPolicy:false,constraint:'none'},evaluatedAt:atIso};
}

app.get('/api/corridors',async()=>corridors);
app.post('/api/corridors/:id/coordinate',async(req:any,res)=>{const c=corridors.find(x=>x.id===(req.params as any).id);if(!c)return res.code(404).send({error:'corridor not found'});const b=req.body as any;const speedKph=Number(b.speedKph||c.targetSpeedKph);if(speedKph<10||speedKph>70)return res.code(400).send({error:'speedKph must be 10-70'});const cycle=Math.max(...c.intersectionIds.map((id:string)=>intersections.find(x=>x.id===id)?.cycle||60));const offsets:any={};let distanceSeconds=0;for(const id of c.intersectionIds){const j=intersections.find(x=>x.id===id)!;distanceSeconds+=c.lengthMeters/c.intersectionIds.length/(speedKph/3.6);offsets[id]=Math.round(distanceSeconds%cycle);j.offset=offsets[id];}const plan={id:randomUUID(),corridorId:c.id,cycleSeconds:cycle,speedKph,offsets,createdAt:now(),status:'coordinated'};plans.push(plan);log('corridor.coordinate',plan);return plan;});
app.post('/api/priority-requests',async(req:any,res)=>{const b=req.body as any;if(!b.intersectionId||!b.routeId||b.etaSeconds==null)return res.code(400).send({error:'intersectionId、routeId、etaSeconds 必填'});const requestType=b.requestType==='emergency'?'emergency':'transit';const etaSeconds=Number(b.etaSeconds);const passengers=Number(b.passengers||0);if(!Number.isFinite(etaSeconds))return res.code(400).send({error:'etaSeconds 必须为数字'});if(!Number.isFinite(passengers)||passengers<0)return res.code(400).send({error:'passengers 必须为非负数字'});const j=intersections.find(x=>x.id===b.intersectionId);if(!j)return res.code(404).send({error:'intersection not found'});const atIso=now();const decision=decidePriorityRequest({intersectionId:b.intersectionId,routeId:String(b.routeId),etaSeconds,passengers,requestType},atIso);const r={id:randomUUID(),intersectionId:b.intersectionId,routeId:String(b.routeId),etaSeconds,passengers,requestType,status:decision.status,approved:decision.approved,reasonCode:decision.reasonCode,reason:decision.reason,duplicateOf:decision.duplicateOf??null,pedestrian:decision.pedestrian,evaluatedAt:decision.evaluatedAt,requestedAt:atIso};priorityRequests.push(r);log('priority.request',r);return r;});
app.post('/api/pedestrian-phase',async(req:any,res)=>{const b=req.body as any;if(!b.intersectionId||b.crossingSeconds==null)return res.code(400).send({error:'intersectionId 和 crossingSeconds 必填'});const crossing=Number(b.crossingSeconds);if(crossing<7||crossing>60)return res.code(400).send({error:'crossingSeconds must be 7-60'});const leadingInterval=Number(b.leadingInterval||3);if(!Number.isFinite(leadingInterval)||leadingInterval<0)return res.code(400).send({error:'leadingInterval 必须为非负数字'});const j=intersections.find(x=>x.id===b.intersectionId);if(!j)return res.code(404).send({error:'intersection not found'});const p={id:randomUUID(),intersectionId:j.id,crossingSeconds:crossing,leadingInterval,requiredClearance:crossing+leadingInterval,accessible:Boolean(b.accessible),status:'validated',createdAt:now()};scenarioPolicies.push(p);log('pedestrian.policy.validate',p);return p;});
app.get('/api/pedestrian-phase',async(req:any)=>{const q=(req.query as any)||{};const list=q.intersectionId?scenarioPolicies.filter(p=>p.intersectionId===q.intersectionId):scenarioPolicies;return{pedestrianPolicies:list,count:list.length};});
app.post('/api/simulations/:id/emissions',async(req:any,res)=>{const r=runs.find(x=>x.id===(req.params as any).id);if(!r)return res.code(404).send({error:'simulation not found'});const vkt=Number((req.body as any)?.vehicleKm||12000);const stopPenalty=(r.candidate?.totalDelay??r.baseline.totalDelay)/Math.max(1,r.baseline.horizon);return{simulationId:r.id,vehicleKm:vkt,co2Kg:Number((vkt*(.142+stopPenalty*.0008)).toFixed(2)),noxGrams:Number((vkt*(.32+stopPenalty*.0015)).toFixed(2)),idleHours:Number((stopPenalty*vkt/3600).toFixed(2)),method:'speed-delay surrogate model'};});
app.post('/api/evacuation-scenarios',async(req:any)=>{const b=req.body as any;const blocked=(b.blockedIntersections||[]) as string[];const original=incidents.length;for(const id of blocked)incidents.push({id:randomUUID(),intersectionId:id,type:'evacuation-block',severity:'high',status:'active',startedAt:now()});const result=simulate({horizon:b.horizon||1800,demand:b.demand});incidents.splice(original);return{id:randomUUID(),type:'evacuation',blockedIntersections:blocked,result,recommendation:result.spillbacks>3?'open reversible lanes and meter upstream inflow':'maintain coordinated offsets'};});
app.get('/api/priority-requests',async(req:any)=>{const q=(req.query as any)||{};let list=priorityRequests;if(q.intersectionId)list=list.filter(r=>r.intersectionId===q.intersectionId);if(q.routeId)list=list.filter(r=>r.routeId===String(q.routeId));if(q.requestType)list=list.filter(r=>r.requestType===q.requestType);if(q.status)list=list.filter(r=>r.status===q.status);return{priorityRequests:list,count:list.length};});
app.get('/api/priority-requests/:id',async(req:any,res)=>{const r=priorityRequests.find(x=>x.id===(req.params as any).id);if(!r)return res.code(404).send({error:'priority request not found'});return r;});

app.listen({port:Number(process.env.PORT||6302),host:'127.0.0.1'}).catch(err=>{app.log.error(err);process.exit(1)});
