import {loadEsca,options,canonicalReply,initial,restore,advance,active,result,engineReply} from './chess.mjs';
import {ChessSurface} from './cm-board.mjs';

const byId=id=>document.getElementById(id), KEY='alfred-chess-demo.v1';
const names={k:'король',q:'ферзь',r:'ладья',b:'слон',n:'конь',p:'пешка'};
const promotionNames={q:'Ферзь',r:'Ладья',b:'Слон',n:'Конь'};
let analyze,game,surface,selected,busy=false,training=false,owns=false,engineFault=false;
let pageActive=true,lockRequest=null,turnGeneration=0,activeWorker=null,failure=null,seenSavedRecord=false;
let pendingPromotion=null,renderedHistory=null;

const btn=(label,action,className='button button--quiet',id=null)=>{
  const el=document.createElement('button');el.type='button';el.textContent=label;
  el.className=className;el.onclick=action;if(id)el.id=id;return el;
};
const token=()=>game?`${turnGeneration}:${game.state.revision}`:null;
const canPlay=()=>!!game&&owns&&pageActive&&!busy&&!training&&!pendingPromotion&&active(game)&&game.position.fen.split(' ')[1]==='w';

function piecesAt(fen){
  const result=new Map();
  fen.split(' ')[0].split('/').forEach((rank,index)=>{
    let file=0;
    for(const piece of rank){if(/[1-8]/.test(piece))file+=Number(piece);else result.set('abcdefgh'[file++]+(8-index),piece);}
  });
  return result;
}
function moveLabel(move){
  if(move==='e1h1'||move==='e8h8')return 'O–O';
  if(move==='e1a1'||move==='e8a8')return 'O–O–O';
  return move.slice(0,2)+'–'+move.slice(2,4)+(move.length===5?'='+({q:'Ф',r:'Л',b:'С',n:'К'}[move.at(-1)]):'');
}
function setStatus(){
  let title,detail,state;
  if(!game){title=failure?'Партия недоступна':'Подготавливаем партию…';detail=failure?'История не изменена.':'Загружаем доску и фигуры.';state=failure?'error':'loading';}
  else if(!owns){title='Только просмотр';detail='Партией управляет другая вкладка. Здесь ходы обновляются автоматически.';state='observer';}
  else if(busy){title='Stockfish думает…';detail='Ход чёрных. Ответ скоро появится на доске.';state='busy';}
  else if(training){title='Разбор позиции';detail='Вернитесь во вкладку «Партия», чтобы продолжить игру.';state='analysis';}
  else if(!active(game)){title=result(game);detail='Можно сохранить историю или начать новую партию.';state='finished';}
  else if(game.position.fen.split(' ')[1]==='w'){title='Ваш ход';detail='Вы играете белыми. Выберите фигуру.';state='ready';}
  else {title=engineFault?'Ответ не получен':'Ход чёрных';detail=engineFault?'Повторите ответ, когда будете готовы.':'Соперник играет чёрными.';state=engineFault?'error':'waiting';}
  byId('status').textContent=title;byId('status-detail').textContent=detail;byId('status-line').dataset.state=state;
}
function renderPlayers(){
  const whiteOnBottom=surface?.orientation!=='b';
  for(const [location,human] of [['top',!whiteOnBottom],['bottom',whiteOnBottom]]){
    byId(`player-${location}-name`).textContent=human?'Вы':'Stockfish';
    byId(`player-${location}-detail`).textContent=human?'Белые':`Чёрные · уровень ${game?.state.skill??5}`;
    const avatar=byId(`player-${location}-avatar`);avatar.textContent=human?'Я':'S';avatar.classList.toggle('player-avatar--you',human);
    const badge=byId(`player-${location}-badge`);
    const turn=game?.position.fen.split(' ')[1],playing=game&&active(game);
    const current=!!playing&&turn===(human?'w':'b');
    badge.textContent=human?(current&&!training?'Ваш ход':'Белые'):(busy?'Думает…':'Чёрные');
    badge.classList.toggle('is-active',current&&!training);
  }
  byId('board').setAttribute('aria-label',`Шахматная доска, ${whiteOnBottom?'белые':'чёрные'} снизу`);
}
function renderHistory(){
  const moves=game?.state.moves||[],signature=JSON.stringify(moves);
  byId('move-count').textContent=String(Math.ceil(moves.length/2));
  byId('history-empty').hidden=moves.length>0;
  if(signature===renderedHistory)return;
  renderedHistory=signature;const list=byId('history');list.replaceChildren();
  moves.forEach((uci,index)=>{
    const item=document.createElement('li');item.className='move-item'+(index===moves.length-1?' is-last':'');
    item.dataset.uci=uci;item.dataset.ply=String(index+1);
    item.setAttribute('aria-label',`${Math.floor(index/2)+1}. ${index%2?'Чёрные':'Белые'}, ${moveLabel(game.wire[index])}`);
    const number=document.createElement('span');number.className='move-number';number.setAttribute('aria-hidden','true');number.textContent=index%2?'…':`${Math.floor(index/2)+1}.`;
    const move=document.createElement('span');move.textContent=moveLabel(uci);
    item.append(number,move);list.append(item);
  });
  list.scrollTop=list.scrollHeight;
}
function updateMoveTargets(){
  const from=byId('move-from').value,previous=byId('move-to').value;
  const targets=game?[...new Set(options(game.position).filter(move=>move.uci.startsWith(from)).map(move=>move.target))].sort():[];
  byId('move-to').replaceChildren();
  for(const target of targets){const item=document.createElement('option');item.value=target;item.textContent=target;byId('move-to').append(item);}
  if(targets.includes(previous))byId('move-to').value=previous;
}
function renderMoveForm(){
  const previous=selected||byId('move-from').value,pieces=game?piecesAt(game.position.fen):new Map();
  const origins=game?[...new Set(options(game.position).map(move=>move.uci.slice(0,2)))].sort():[];
  byId('move-from').replaceChildren();
  for(const square of origins){
    const item=document.createElement('option');item.value=square;
    const name=names[pieces.get(square)?.toLowerCase()]||'фигура';item.textContent=name[0].toUpperCase()+name.slice(1)+' '+square;
    byId('move-from').append(item);
  }
  if(origins.includes(previous))byId('move-from').value=previous;
  updateMoveTargets();
  if(game){
    const side=white=>[...pieces].filter(([,piece])=>(piece===piece.toUpperCase())===white).map(([square,piece])=>`${names[piece.toLowerCase()]} ${square}`).join(', ');
    byId('board-position').textContent=`Белые: ${side(true)}. Чёрные: ${side(false)}.`;
  }else byId('board-position').textContent='';
}
function updateControlAvailability(){
  const playable=canPlay()&&!surface?.busy;
  for(const id of ['move-from','move-to','move-submit'])byId(id).disabled=!playable;
  byId('flip-board').disabled=!game||!surface||surface.busy||!!pendingPromotion;
  const canAdjust=!!game&&owns&&!busy&&!training&&!pendingPromotion&&active(game)&&game.position.fen.split(' ')[1]==='w';
  byId('elo').disabled=!canAdjust;
  byId('apply-strength').disabled=!canAdjust||byId('elo').valueAsNumber===game.state.skill;
  byId('facts-toggle').disabled=!game||busy||!!pendingPromotion;
  byId('game-mode').disabled=!game||busy||!!pendingPromotion;
}
function renderFacts(){
  const panel=byId('facts');panel.replaceChildren();if(!game||!training)return;
  const intro=document.createElement('p');intro.className='analysis-intro';
  const heading=document.createElement('strong');heading.textContent='Что происходит на доске';
  intro.append(heading,document.createTextNode('Пешки, активность и уязвимые фигуры в текущей позиции.'));panel.append(intro);
  const facts=game.position.facts;
  const show=value=>Array.isArray(value)?(value.join(', ')||'нет'):String(value);
  const pair=(label,values)=>{
    const card=document.createElement('section');card.className='fact-card';
    const title=document.createElement('h3');title.textContent=label;card.append(title);
    const list=document.createElement('dl');
    for(const [name,value] of [['Белые',values.white],['Чёрные',values.black]]){
      const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=name;detail.textContent=show(value);list.append(term,detail);
    }card.append(list);panel.append(card);
  };
  pair('Изолированные пешки',facts.pawns.isolated);
  pair('Проходные пешки',facts.pawns.passed);
  pair('Под ударом без защиты',facts.attacks.hanging);
  pair('Контроль центра',facts.mobility.centre_control);
  for(const [label,value] of [['Открытые вертикали',show(facts.pawns.open_files)],['Допустимых ходов',String(options(game.position).length)]]){
    const card=document.createElement('div');card.className='fact-card fact-single';
    const title=document.createElement('span'),detail=document.createElement('strong');title.textContent=label;detail.textContent=value;card.append(title,detail);panel.append(card);
  }
}
function renderActions(){
  const actions=byId('actions');actions.replaceChildren();
  if(!game||!owns||busy||pendingPromotion)return;
  const playing=active(game),white=game.position.fen.split(' ')[1]==='w';
  if(playing&&!white)actions.append(btn('Повторить ответ',()=>reply(),'button button--primary action-wide','retry-engine'));
  if(playing&&white)for(const claim of game.position.claims)actions.append(btn('Заявить ничью',()=>act({type:'claim',claim}),'button button--quiet action-wide'));
  actions.append(btn('Новая партия',()=>{if(!playing||confirm('Начать новую партию?'))act({type:'reset'});},'button button--primary','new-game'));
  if(playing)actions.append(btn('Сдаться',()=>{if(confirm('Сдаться?'))act({type:'resign'});},'button button--subtle','resign'));
}
function render(){
  byId('export').disabled=!game;
  byId('board-mask').hidden=!!game;
  byId('board-mask').firstElementChild.textContent=failure?'Партия недоступна':'Подготавливаем доску…';
  byId('game-panel').hidden=training;byId('facts').hidden=!training;
  for(const [id,chosen] of [['game-mode',!training],['facts-toggle',training]]){byId(id).setAttribute('aria-selected',String(chosen));byId(id).tabIndex=chosen?0:-1;}
  byId('fen').textContent=game?.position.fen||'';
  byId('elo').value=game?.state.skill??5;byId('level-preview').value=String(game?.state.skill??5);
  if(!game)byId('error').textContent=failure?.message||'';
  setStatus();renderPlayers();renderHistory();renderMoveForm();renderActions();renderFacts();
  surface?.sync(game?{fen:game.position.fen,enabled:canPlay(),legal:options(game.position),last:game.wire.at(-1),token:token()}:null);
  updateControlAvailability();
  if(!selected)byId('board-hint').textContent=training?'Чтобы сделать ход, вернитесь к партии.':'Нажмите на фигуру и клетку или перетащите фигуру.';
}

function closePromotion(){
  pendingPromotion=null;if(byId('promotion').open)byId('promotion').close();byId('promotion-options').replaceChildren();
}
function choosePromotion(uci,expectedToken){
  if(!pendingPromotion||pendingPromotion.token!==expectedToken)return;
  const valid=token()===expectedToken&&pendingPromotion.moves.some(move=>move.uci===uci);
  closePromotion();render();
  if(valid&&canPlay())human(uci);
}
function askPromotion(moves,expectedToken){
  pendingPromotion={moves,token:expectedToken};
  byId('promotion-square').textContent=moves[0].target;byId('promotion-options').replaceChildren();
  for(const piece of ['q','r','b','n']){
    const move=moves.find(item=>item.uci.endsWith(piece));if(!move)continue;
    const button=btn(promotionNames[piece],()=>choosePromotion(move.uci,expectedToken),'promotion-piece');button.dataset.promotion=piece;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 40 40');svg.setAttribute('aria-hidden','true');
    const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#w'+piece);svg.append(use);button.prepend(svg);
    byId('promotion-options').append(button);
  }
  render();
  try{byId('promotion').showModal();}catch(error){closePromotion();byId('error').textContent='Не удалось открыть выбор фигуры. Попробуйте ещё раз.';render();}
}
function requestMove(from,to,expectedToken=token()){
  if(!canPlay()||surface?.busy||token()!==expectedToken)return;
  const moves=options(game.position).filter(move=>move.uci.startsWith(from)&&move.target===to);
  if(moves.length===1)human(moves[0].uci);
  else if(moves.length>1)askPromotion(moves,expectedToken);
  else byId('error').textContent='Выберите допустимый ход для этой фигуры.';
}
function act(action){if(!owns||busy)return false;byId('error').textContent='';try{const next=advance(analyze,game,action);localStorage.setItem(KEY,JSON.stringify(next.state));seenSavedRecord=true;game=next;engineFault=false;selected=null;closePromotion();render();return true;}catch(e){byId('error').textContent=e.message;return false;}}
async function human(uci){if(act({type:'move',actor:'human',uci}))await reply();}
async function reply(){if(!owns||busy||!game||!active(game)||game.position.fen.split(' ')[1]!=='b')return;
  const rev=game.state.revision,generation=turnGeneration;let worker;
  const current=()=>pageActive&&owns&&generation===turnGeneration&&game?.state.revision===rev;
  busy=true;engineFault=false;byId('error').textContent='';render();
  try{const wire=await engineReply(()=>{worker=new Worker('./engine/stockfish-19-lite-single.js');activeWorker=worker;return worker;},game.wire,game.state.skill);
    if(!current())return;const uci=canonicalReply(game.position,wire);busy=false;
    if(!act({type:'move',actor:'stockfish',uci}))engineFault=true;
  }catch(e){if(current()){engineFault=true;byId('error').textContent=e.message;}}
  finally{if(generation===turnGeneration){busy=false;if(activeWorker===worker)activeWorker=null;render();}}}

byId('strength').onsubmit=e=>{e.preventDefault();act({type:'skill',skill:byId('elo').valueAsNumber});};
byId('elo').oninput=()=>{byId('level-preview').value=byId('elo').value;updateControlAvailability();};
byId('move-from').onchange=()=>updateMoveTargets();
byId('move-form').onsubmit=event=>{event.preventDefault();requestMove(byId('move-from').value,byId('move-to').value);};
byId('flip-board').onclick=()=>{if(surface?.flip())renderPlayers();};
byId('promotion-cancel').onclick=()=>{closePromotion();render();};
byId('promotion').addEventListener('cancel',event=>{event.preventDefault();closePromotion();render();});
function setMode(analysis){
  if(!game||busy||pendingPromotion)return;
  training=analysis;selected=null;surface?.stopInput();render();
}
byId('facts-toggle').onclick=()=>setMode(true);
byId('game-mode').onclick=()=>setMode(false);
for(const id of ['game-mode','facts-toggle'])byId(id).addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();const analysis=event.key==='End'?true:event.key==='Home'?false:!training;setMode(analysis);byId(analysis?'facts-toggle':'game-mode').focus();
});
document.querySelector('.skip-link').onclick=()=>{byId('keyboard-move').open=true;};
byId('export').onclick=()=>{if(!game)return;const blob=new Blob([JSON.stringify({state:game.state,fen:game.position.fen,outcome:game.position.outcome},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='alfred-chess-local.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

function invalidateTurn(){
  turnGeneration++;activeWorker?.terminate();activeWorker=null;busy=false;engineFault=false;selected=null;
  closePromotion();
}
function releaseOwnership(){
  owns=false;invalidateTurn();const previous=lockRequest;lockRequest=null;
  previous?.controller.abort();previous?.release?.();
}
function failClosed(error){releaseOwnership();failure=error;game=null;render();}
function readSavedGame(){
  const raw=localStorage.getItem(KEY);
  if(raw===null&&seenSavedRecord)throw Error('Сохранённая партия удалена. Перезагрузите страницу для новой партии.');
  const restored=restore(analyze,raw===null?initial():JSON.parse(raw));
  if(raw!==null)seenSavedRecord=true;
  return restored;
}
function refreshObserver(){
  const fresh=readSavedGame();invalidateTurn();game=fresh;failure=null;byId('error').textContent='';render();
}
function resume(){
  if(!pageActive||!analyze||lockRequest)return;
  try{refreshObserver();}catch(e){failClosed(e);return;}
  const request={controller:new AbortController(),release:null};lockRequest=request;
  // Keep one cancellable request queued: an observing tab takes over only after
  // the previous owner releases its lock, and always reloads the committed game.
  navigator.locks.request(KEY,{signal:request.controller.signal},async()=>{
    if(!pageActive||lockRequest!==request)return;
    const fresh=readSavedGame();invalidateTurn();game=fresh;failure=null;owns=true;
    byId('error').textContent='';render();
    const released=new Promise(resolve=>{request.release=resolve;});
    if(active(game)&&game.position.fen.split(' ')[1]==='b')reply();
    await released;
    if(lockRequest===request){owns=false;invalidateTurn();render();}
  }).catch(e=>{
    if(lockRequest===request&&e.name!=='AbortError')failClosed(e);
  }).finally(()=>{if(lockRequest===request)lockRequest=null;});
}
window.addEventListener('pagehide',()=>{pageActive=false;releaseOwnership();render();});
window.addEventListener('pageshow',()=>{pageActive=true;resume();});
window.addEventListener('storage',event=>{
  if(event.storageArea!==localStorage||(event.key!==KEY&&event.key!==null)||!pageActive||!analyze)return;
  try{
    if(event.key===null||event.newValue===null)throw Error('Сохранённая партия удалена. Перезагрузите страницу для новой партии.');
    if(owns){
      // A prior owner's storage event may arrive after lock handover. Ignore it
      // when acquisition already loaded that same committed record.
      if(JSON.stringify(readSavedGame().state)===JSON.stringify(game.state))return;
      throw Error('Партия изменена вне активной вкладки. Перезагрузите страницу.');
    }
    if(lockRequest)refreshObserver();else resume();
  }catch(e){failClosed(e);}
});
async function startup(){
  if(!navigator.locks)throw Error('Нужен браузер с Web Locks и безопасный origin (HTTPS/localhost)');
  surface=new ChessSurface(byId('board'),{
    onIntent:requestMove,
    onSelection:square=>{
      selected=square;
      if(square){byId('move-from').value=square;updateMoveTargets();}
      byId('board-hint').textContent=square?`Выбрано ${square}. Укажите клетку назначения.`:training?'Чтобы сделать ход, вернитесь к партии.':'Нажмите на фигуру и клетку или перетащите фигуру.';
    },
    onInvalid:()=>{byId('error').textContent='На эту клетку сейчас нельзя пойти.';},
    onBusyChange:updateControlAvailability,
    onError:()=>failClosed(Error('Не удалось обновить доску. Перезагрузите страницу.')),
  });
  const res=await fetch('./engine/esca.wasm.gz');if(!res.ok||!res.body)throw Error('Esca WASM отсутствует');if(typeof DecompressionStream!=='function')throw Error('Нужен современный браузер с распаковкой gzip');const rawWasm=await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();analyze=await loadEsca(rawWasm);
  resume();
}
render();startup().catch(failClosed);
