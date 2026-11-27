// Standalone offline experiment; deliberately not the shared MCP game's authority.
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
export const MAX_PLIES = 512;
const CASTLE = {e1h1:'e1g1',e1a1:'e1c1',e8h8:'e8g8',e8a8:'e8c8'};
export async function loadEsca(bytes) {
  const {module,instance} = await WebAssembly.instantiate(bytes,{});
  if (WebAssembly.Module.imports(module).length) throw Error('Unexpected Esca imports');
  const e=instance.exports, enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
  return (moves=[],fen=null) => {
    if (!Array.isArray(moves)||moves.length>MAX_PLIES||moves.some(m=>typeof m!=='string'||!UCI.test(m))) throw Error('Invalid move history');
    const input=enc.encode(JSON.stringify({fen,moves}));const ptr=e.probe_input(input.length);
    if (!ptr) throw Error('Esca input rejected');new Uint8Array(e.memory.buffer,ptr,input.length).set(input);
    const size=e.probe_analyze();const data=JSON.parse(dec.decode(new Uint8Array(e.memory.buffer,e.probe_output(),size)));
    if(data.error)throw Error(data.error);
    return data;
  };
}
export function options(position) {
  if(position.outcome!==null)return [];
  return position.annotations.map(a=>{
    const wire=a.facts.is_castling?CASTLE[a.uci]:a.uci;
    if(!wire||!UCI.test(wire))throw Error('Unsupported move');
    return {uci:a.uci,wire,target:wire.slice(2,4),facts:a.facts};
  });
}
export function canonicalReply(position,wire){
  const matches=options(position).filter(m=>m.wire===wire);
  if(matches.length!==1)throw Error('Ответ движка не подтверждён Esca. Ход не сохранён.');
  return matches[0].uci;
}
export function initial(skill=5){return {schema:1,revision:0,moves:[],skill,finish:null};}
function checkState(s){
  if(!s||s.schema!==1||!Number.isSafeInteger(s.revision)||s.revision<0||!Array.isArray(s.moves)||s.moves.length>MAX_PLIES||!Number.isInteger(s.skill)||s.skill<0||s.skill>20)throw Error('Invalid stored game');
  if(s.finish!==null&&(!s.finish||!['resign','claim'].includes(s.finish.kind)))throw Error('Invalid result');
}
export function restore(analyze,s){
  checkState(s);let p=analyze([]),moves=[],wire=[];
  for(const uci of s.moves){
    const m=options(p).find(x=>x.uci===uci);if(!m)throw Error('Illegal or terminal history');
    moves.push(uci);wire.push(m.wire);p=analyze(moves);
  }
  if(s.finish&&(p.outcome!==null||(s.finish.kind==='claim'&&(p.fen.split(' ')[1]!=='w'||!p.claims.includes(s.finish.claim)))))throw Error('Invalid stored finish');
  return {state:structuredClone(s),position:p,wire};
}
export function advance(analyze,g,action){
  const s=structuredClone(g.state),p=g.position;
  if(action.type==='reset')return restore(analyze,{...initial(s.skill),revision:s.revision+1});
  if(s.finish||p.outcome!==null||s.moves.length>=MAX_PLIES)throw Error('Game over');
  if(action.type==='skill'){
    if(!Number.isInteger(action.skill)||action.skill<0||action.skill>20)throw Error('Invalid strength');s.skill=action.skill;
  }else if(action.type==='resign'){s.finish={kind:'resign'};}
  else if(action.type==='claim'){
    if(p.fen.split(' ')[1]!=='w'||!p.claims.includes(action.claim))throw Error('Draw claim unavailable');s.finish={kind:'claim',claim:action.claim};
  }else if(action.type==='move'){
    const side=p.fen.split(' ')[1],expected=action.actor==='human'?'w':action.actor==='stockfish'?'b':null;
    if(side!==expected)throw Error('Wrong seat');const m=options(p).find(x=>x.uci===action.uci);if(!m)throw Error('Illegal move');
    s.moves.push(m.uci);s.revision++;return {state:s,position:analyze(s.moves),wire:[...g.wire,m.wire]};
  }else throw Error('Unknown action');
  s.revision++;return {state:s,position:p,wire:g.wire.slice()};
}
export function active(g){return !g.state.finish&&g.position.outcome===null&&g.state.moves.length<MAX_PLIES;}
export function result(g){
  if(g.state.finish?.kind==='resign')return '0–1 · Вы сдались';
  if(g.state.finish?.kind==='claim')return '½–½ · Ничья заявлена';
  const out=g.position.outcome;
  if(out?.startsWith('Checkmate'))return out.includes('winner: w')?'1–0 · Мат':'0–1 · Мат';
  if(out)return '½–½ · '+out;
  if(g.state.moves.length>=MAX_PLIES)return 'Достигнут лимит прототипа (512 полуходов)';
  return '';
}
// One engine per outstanding turn. No shell, network API, custom commands or PV exposure.
export async function engineReply(makeWorker,wire,skill,{timeout=15000,movetime=150}={}){
  if(!Array.isArray(wire)||wire.some(m=>!UCI.test(m))||!Number.isInteger(skill)||skill<0||skill>20)throw Error('Invalid engine arguments');
  const worker=makeWorker();let waiter,dead=null,optionsText=[];
  function fail(e){dead=e;waiter?.reject(e);}
  const receive=event=>{for(const line of String(event.data).split(/\r?\n/)){
    if(line.startsWith('option name '))optionsText.push(line);
    if(waiter?.match(line)) {const current=waiter;waiter=undefined;current.resolve(line);}
  }};
  worker.addEventListener('message',receive);worker.addEventListener('error',()=>fail(Error('Stockfish worker недоступен')));
  const ask=(command,match)=>new Promise((resolve,reject)=>{
    if(dead)return reject(dead);if(waiter)return reject(Error('Concurrent UCI command'));
    const timer=setTimeout(()=>{waiter=undefined;reject(Error('Stockfish: истекло время ожидания'));},timeout);
    waiter={match,resolve:x=>{clearTimeout(timer);resolve(x);},reject:e=>{clearTimeout(timer);reject(e);}};
    try{worker.postMessage(command);}catch(e){fail(e);}
  });
  try{
    await ask('uci',l=>l==='uciok');
    if(!optionsText.some(l=>l.startsWith('option name Skill Level type spin ')))throw Error('Не найдена настройка Skill Level');
    worker.postMessage('setoption name Skill Level value '+skill);
    await ask('isready',l=>l==='readyok');
    worker.postMessage('position startpos'+(wire.length?' moves '+wire.join(' '):''));
    const line=await ask('go movetime '+movetime,l=>l.startsWith('bestmove '));
    const best=line.split(/\s+/)[1];if(!UCI.test(best))throw Error('Нет допустимого ответа Stockfish');return best;
  }finally{worker.terminate();}
}
