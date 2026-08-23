import { getCloudflareContext } from "@opennextjs/cloudflare"

export type InweSession = {
 id:string; username:string; cookie:string; authToken:string|null; level:number|null;
 pointPct:number|null; hoursLeft:number|null; referred:number|null; status:string;
 lastChecked:Date; createdAt:Date
}
function map(r:any):InweSession { return {...r, authToken:r.authToken??null, level:r.level??null, pointPct:r.pointPct??null, hoursLeft:r.hoursLeft??null, referred:r.referred??null, lastChecked:new Date(r.lastChecked), createdAt:new Date(r.createdAt)} }
async function d1(){ const { env } = await getCloudflareContext(); return env.DB as D1Database }
export const db = { inweSession: {
 async findUnique({where:{username}}:{where:{username:string}}){ const r=await (await d1()).prepare("SELECT * FROM InweSession WHERE username=?").bind(username).first(); return r?map(r):null },
 async findMany(args:any={}){ let q="SELECT * FROM InweSession", b:any[]=[]; if(args.where?.username?.in){q+=" WHERE username IN ("+args.where.username.in.map(()=>"?").join(",")+")";b=args.where.username.in} if(args.orderBy?.createdAt==="desc")q+=" ORDER BY createdAt DESC"; const x=await (await d1()).prepare(q).bind(...b).all(); let rows=(x.results||[]).map(map); if(args.select) return rows.map((r:any)=>Object.fromEntries(Object.keys(args.select).filter(k=>args.select[k]).map(k=>[k,r[k]]))); return rows },
 async upsert({where:{username},update,create}:any){ const old=await this.findUnique({where:{username}}); if(old){await this.update({where:{username},data:update}); return (await this.findUnique({where:{username}}))!} const now=new Date().toISOString(), id=crypto.randomUUID(); await (await d1()).prepare("INSERT INTO InweSession (id,username,cookie,authToken,level,pointPct,hoursLeft,referred,status,lastChecked,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(id,username,create.cookie,create.authToken??null,create.level??null,create.pointPct??null,create.hoursLeft??null,create.referred??null,create.status??"active",now,now).run(); return (await this.findUnique({where:{username}}))! },
 async update({where:{username},data}:any){ const keys=Object.keys(data); const vals=keys.map(k=>data[k] instanceof Date?data[k].toISOString():data[k]); await (await d1()).prepare("UPDATE InweSession SET "+keys.map(k=>`${k}=?`).join(",")+" WHERE username=?").bind(...vals,username).run(); const r=await this.findUnique({where:{username}}); if(!r) throw new Error("Session not found"); return r },
 async deleteMany(args:any={}){ let q="DELETE FROM InweSession",b:any[]=[]; if(args.where?.username){q+=" WHERE username=?";b=[args.where.username]} const r=await (await d1()).prepare(q).bind(...b).run(); return {count:r.meta.changes??0} }
}}
