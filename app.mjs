import {loadEsca,options,canonicalReply,initial,restore,advance,active,result,engineReply} from './chess.mjs';
const byId=id=>document.getElementById(id), KEY='alfred-chess-demo.v1';
const glyphs={K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙',k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'};
const names={k:'король',q:'ферзь',r:'ладья',b:'слон',n:'конь',p:'пешка'};
let analyze,game,selected,busy=false,training=false,owns=false,engineFault=false;
const btn=(label,action)=>{const el=document.createElement('button');el.type='button';el.textContent=label;el.onclick=action;return el;};
function render(){
  if(!game)return;const {state,position}=game,board=byId('board'),playing=active(game),white=position.fen.split(' ')[1]==='w';
  const pieces=position.fen.split(' ')[0].replaceAll('/','').replace(/[1-8]/g,n=>'.'.repeat(+n));
  const legal=owns&&playing&&white&&!busy?options(position):[],origins=new Set(legal.map(m=>m.uci.slice(0,2))),choices=legal.filter(m=>m.uci.startsWith(selected||'--')),last=game.wire.at(-1);
  const focus=board.contains(document.activeElement)?document.activeElement.dataset.square:null;board.replaceChildren();
  [...pieces].forEach((piece,i)=>{const file=i%8,rank=8-Math.floor(i/8),square='abcdefgh'[file]+rank,targets=choices.filter(m=>m.target===square);
    const tile=btn(glyphs[piece]||'',()=>select(square,targets));tile.dataset.square=square;tile.className='square'+((file+rank)%2?' dark':'')+(targets.length?' target':'')+(last&&[last.slice(0,2),last.slice(2,4)].includes(square)?' last':'');
    tile.setAttribute('aria-label',square+', '+(piece==='.'?'пусто':(piece===piece.toUpperCase()?'белые ':'чёрные ')+names[piece.toLowerCase()]));tile.setAttribute('aria-pressed',String(square===selected));tile.disabled=!origins.has(square)&&!targets.length;
    if(file===0||rank===1){const c=document.createElement('span');c.className='coordinate';c.textContent=(file===0?rank:'')+(rank===1?square[0]:'');c.setAttribute('aria-hidden','true');tile.append(c);}board.append(tile);
  });if(focus)board.querySelector(`[data-square="${focus}"]:enabled`)?.focus();
  byId('status').textContent=!owns?'Открыта другая вкладка · только просмотр':busy?'Stockfish думает…':!playing?result(game):white?'Ваш ход · белые':engineFault?'Ответ движка не получен':'Ход чёрных';
  byId('fen').textContent=position.fen;const history=byId('history');history.replaceChildren();state.moves.forEach((uci,i)=>{const li=document.createElement('li');li.textContent=(i%2?'Stockfish':'Вы')+' · '+game.wire[i];history.append(li);});history.scrollTop=history.scrollHeight;
  byId('elo').value=state.skill;for(const el of byId('strength').elements)el.disabled=!owns||busy||!playing||!white;
  const actions=byId('actions');actions.replaceChildren();if(owns&&!busy){
    if(playing&&white)for(const claim of position.claims)actions.append(btn('Заявить ничью',()=>act({type:'claim',claim})));
    if(playing&&!white)actions.append(btn('Повторить ответ',()=>reply()));
    if(playing)actions.append(btn('Сдаться',()=>{if(confirm('Сдаться?'))act({type:'resign'});}));
    actions.append(btn('Новая партия',()=>{if(!playing||confirm('Начать новую локальную партию?'))act({type:'reset'});}));
  }
  byId('facts-toggle').textContent=training?'Вернуться в режим партии':'Режим разбора';const facts=byId('facts');facts.hidden=!training;facts.replaceChildren();
  if(training){const f=position.facts;const lines=[`Легальных ходов: ${options(position).length}`,`Изолированные пешки белых: ${f.pawns.isolated.white.join(', ')||'нет'}`,`Проходные пешки белых: ${f.pawns.passed.white.join(', ')||'нет'}`,`Атакованные и незащищённые фигуры белых: ${f.attacks.hanging.white.join(', ')||'нет'}`,`Открытые вертикали: ${f.pawns.open_files.join(', ')||'нет'}`,`Контроль центра: белые ${f.mobility.centre_control.white}, чёрные ${f.mobility.centre_control.black}`];
    for(const line of lines){const el=document.createElement('p');el.textContent=line;facts.append(el);} }
}
function select(square,targets){byId('promotion').replaceChildren();if(targets.length===1)return human(targets[0].uci);if(targets.length>1){for(const m of targets)byId('promotion').append(btn(names[m.uci.at(-1)],()=>human(m.uci)));return;}selected=selected===square?null:square;render();}
function act(action){if(!owns||busy)return false;byId('error').textContent='';try{const next=advance(analyze,game,action);localStorage.setItem(KEY,JSON.stringify(next.state));game=next;engineFault=false;selected=null;byId('promotion').replaceChildren();render();return true;}catch(e){byId('error').textContent=e.message;return false;}}
async function human(uci){if(act({type:'move',actor:'human',uci}))await reply();}
async function reply(){if(!owns||busy||!active(game)||game.position.fen.split(' ')[1]!=='b')return;
  const rev=game.state.revision;busy=true;engineFault=false;byId('error').textContent='';render();
  try{const wire=await engineReply(()=>new Worker('./engine/stockfish-19-lite-single.js'),game.wire,game.state.skill);
    if(!owns||game.state.revision!==rev)throw Error('Позиция изменилась');const uci=canonicalReply(game.position,wire);busy=false;act({type:'move',actor:'stockfish',uci});
  }catch(e){engineFault=true;byId('error').textContent=e.message;}finally{busy=false;render();}}
byId('strength').onsubmit=e=>{e.preventDefault();act({type:'skill',skill:byId('elo').valueAsNumber});};
byId('facts-toggle').onclick=()=>{training=!training;render();};
byId('export').onclick=()=>{if(!game)return;const blob=new Blob([JSON.stringify({state:game.state,fen:game.position.fen,outcome:game.position.outcome},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='alfred-chess-local.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
async function startup(){const res=await fetch('./engine/esca.wasm.gz');if(!res.ok||!res.body)throw Error('Esca WASM отсутствует');if(typeof DecompressionStream!=='function')throw Error('Нужен современный браузер с распаковкой gzip');const rawWasm=await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();analyze=await loadEsca(rawWasm);
  if(!navigator.locks)throw Error('Нужен браузер с Web Locks и безопасный origin (HTTPS/localhost)');
  await navigator.locks.request(KEY,{ifAvailable:true},async lock=>{owns=!!lock;const raw=localStorage.getItem(KEY);game=restore(analyze,raw?JSON.parse(raw):initial());render();if(!owns)return;
    if(active(game)&&game.position.fen.split(' ')[1]==='b')reply();await new Promise(resolve=>window.addEventListener('pagehide',resolve,{once:true}));owns=false;});
}
startup().catch(e=>{byId('status').textContent='Прототип недоступен';byId('error').textContent=e.message;});
