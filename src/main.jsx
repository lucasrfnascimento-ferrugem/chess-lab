import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Chess } from 'chess.js';
import { supabase } from './lib/supabase.js';
import './styles.css';

const PIECES = { wk:'♔', wq:'♕', wr:'♖', wb:'♗', wn:'♘', wp:'♙', bk:'♚', bq:'♛', br:'♜', bb:'♝', bn:'♞', bp:'♟' };
const FILES = 'abcdefgh';
const squareName = (file, rank) => `${FILES[file]}${8-rank}`;
const squareXY = (square) => ({ x: FILES.indexOf(square[0]) + .5, y: 8 - Number(square[1]) + .5 });
const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
function pvToSan(fen,pv){const g=new Chess(fen);const out=[];for(const u of (pv||[]).slice(0,9)){try{const m=g.move({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4]||'q'});if(!m)break;out.push(m.san);}catch{break;}}return out.join(' ');}

function App(){
  const [session,setSession] = useState(null);
  const [authOpen,setAuthOpen] = useState(false);
  const [authMode,setAuthMode] = useState('login');
  const [authEmail,setAuthEmail] = useState('');
  const [authPassword,setAuthPassword] = useState('');
  const [displayName,setDisplayName] = useState('');
  const [authBusy,setAuthBusy] = useState(false);
  const [authMessage,setAuthMessage] = useState('');
  const [profile,setProfile] = useState(null);
  const [savedGames,setSavedGames] = useState([]);
  const [leaderboard,setLeaderboard] = useState([]);
  const [exercises,setExercises] = useState([]);
  const [exerciseTitle,setExerciseTitle] = useState('');
  const [exerciseDescription,setExerciseDescription] = useState('');
  const [exerciseDifficulty,setExerciseDifficulty] = useState('intermediate');
  const [dashboardTab,setDashboardTab] = useState('history');
  const savedGameKeyRef = useRef('');
  const [gameMode,setGameMode] = useState('both');
  const [humanColor,setHumanColor] = useState('w');
  const [orientation,setOrientation] = useState('w');
  const [initialFen,setInitialFen] = useState('start');
  const turnRef = useRef('w');
  const [fenInput,setFenInput] = useState('');
  const [pgnInput,setPgnInput] = useState('');
  const [showImport,setShowImport] = useState(false);
  const [showArrows,setShowArrows] = useState(true);
  const [showThreats,setShowThreats] = useState(true);
  const [showAlt,setShowAlt] = useState(true);
  const [analysisOn,setAnalysisOn] = useState(true);
  const [depth,setDepth] = useState(16);
  const [engineLevel,setEngineLevel] = useState(5);
  const engineCandidatesRef = useRef([]);
  const [selected,setSelected] = useState(null);
  const [promotion,setPromotion] = useState(null);
  const [historyIndex,setHistoryIndex] = useState(0);
  const [moves,setMoves] = useState([]);
  const [engineState,setEngineState] = useState('Carregando engine…');
  const [engineLines,setEngineLines] = useState([]);
  const [bestMove,setBestMove] = useState(null);
  const [evalCp,setEvalCp] = useState(0);
  const [mate,setMate] = useState(null);
  const [thinking,setThinking] = useState(false);
  const [notice,setNotice] = useState('Selecione uma peça e depois a casa de destino.');
  const [soundOn,setSoundOn] = useState(true);
  const [soundVolume,setSoundVolume] = useState(55);
  const audioRef = useRef(null);
  const workerRef = useRef(null);
  const engineReady = useRef(false);
  const requestId = useRef(0);
  const game = useMemo(()=>{
    const g = new Chess(initialFen==='start'?undefined:initialFen);
    for(let i=0;i<historyIndex;i++) g.move(moves[i]);
    return g;
  },[moves,historyIndex,initialFen]);
  const fen = game.fen();
  const turn = game.turn();
  turnRef.current = turn;
  const history = game.history({verbose:true});
  const legalMoves = selected ? game.moves({square:selected,verbose:true}) : [];
  const legalTargets = new Set(legalMoves.map(m=>m.to));
  const lastMove = history.at(-1);
  const status = game.isCheckmate() ? `Xeque-mate — ${turn==='w'?'pretas':'brancas'} vencem` : game.isStalemate() ? 'Empate por afogamento' : game.isDraw() ? 'Empate' : game.isCheck() ? `${turn==='w'?'Brancas':'Pretas'} jogam · Xeque` : `${turn==='w'?'Brancas':'Pretas'} jogam`;
  const computerTurn = gameMode==='computer' && turn!==humanColor && !game.isGameOver() && historyIndex===moves.length;

  useEffect(()=>{
    try{
      const worker = new Worker(`${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`);
      workerRef.current = worker;
      worker.onmessage = (event)=>{
        const line = String(event.data || '');
        if(line==='uciok'){worker.postMessage('setoption name MultiPV value 5');worker.postMessage('isready');}
        if(line==='readyok'){engineReady.current=true;setEngineState('Stockfish 19 Lite · pronto');}
        if(line.startsWith('info ')) parseEngineInfo(line);
        if(line.startsWith('bestmove ')){
          const fallback=line.split(/\s+/)[1];
          const ranked=[...engineCandidatesRef.current].sort((a,b)=>{
            const score=x=>x.score??(x.mate!==null?(x.mate>0?100:-100):0);
            return turnRef.current==='w'?score(b)-score(a):score(a)-score(b);
          });
          const tolerances={1:2.0,2:1.2,3:0.7,4:0.3,5:0};
          const best=ranked[0];
          const bestScore=best?(best.score??(best.mate!==null?(best.mate>0?100:-100):0)):0;
          const eligible=ranked.filter(item=>{
            const score=item.score??(item.mate!==null?(item.mate>0?100:-100):0);
            const loss=turnRef.current==='w'?bestScore-score:score-bestScore;
            return loss<=(tolerances[engineLevel]??0)+0.001;
          });
          let chosen=best;
          if(engineLevel===1&&eligible.length>1){
            chosen=eligible[eligible.length-1];
          }else if(engineLevel<5&&eligible.length>1){
            chosen=eligible[Math.floor(Math.random()*eligible.length)]||best;
          }
          const uci=chosen?.pv?.[0]||fallback;
          setBestMove(uci&&uci!=='(none)'?{from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]||null}:null);
          setThinking(false);
        }
      };
      worker.onerror=()=>setEngineState('Falha ao carregar engine. Confira os arquivos WASM.');
      worker.postMessage('uci');
      return ()=>{worker.postMessage('quit');worker.terminate();workerRef.current=null;};
    }catch(e){setEngineState('Engine indisponível: '+e.message);}
  },[]);

  function parseEngineInfo(line){
    const pvMatch=line.match(/\bpv\s+(.+)$/); if(!pvMatch)return;
    const multipv=Number(line.match(/\bmultipv\s+(\d+)/)?.[1]||1);
    const depthNow=Number(line.match(/\bdepth\s+(\d+)/)?.[1]||0);
    const cpMatch=line.match(/\bscore cp (-?\d+)/), mateMatch=line.match(/\bscore mate (-?\d+)/);
    let score=cpMatch?Number(cpMatch[1])/100:null, mateScore=mateMatch?Number(mateMatch[1]):null;
    if(score!==null && turnRef.current==='b') score=-score;
    if(mateScore!==null && turnRef.current==='b') mateScore=-mateScore;
    const pv=pvMatch[1].trim().split(/\s+/);
    const item={multipv,depth:depthNow,score,mate:mateScore,pv};
    engineCandidatesRef.current=[...engineCandidatesRef.current.filter(x=>x.multipv!==multipv),item].sort((a,b)=>a.multipv-b.multipv);
    setEngineLines(prev=>{const next=[...prev.filter(x=>x.multipv!==multipv),item].sort((a,b)=>a.multipv-b.multipv);return next;});
    if(multipv===1){if(score!==null)setEvalCp(score);setMate(mateScore);}
  }

  const analyze = useCallback((position)=>{
    const worker=workerRef.current;
    if(!worker||!engineReady.current||(!analysisOn&&gameMode!=='computer'))return;
    requestId.current++;
    worker.postMessage('stop');
    engineCandidatesRef.current=[];setEngineLines([]);setBestMove(null);setThinking(true);
    worker.postMessage(`position fen ${position}`);
    worker.postMessage(`go depth ${depth}`);
  },[analysisOn,depth,gameMode]);

  useEffect(()=>{
    if(engineReady.current && analysisOn) analyze(fen);
    else if(!analysisOn&&gameMode!=='computer'){setThinking(false);setEngineLines([]);setBestMove(null);}
  },[fen,analysisOn,depth,analyze,engineState,gameMode]);

  useEffect(()=>{
    if(!computerTurn || !engineReady.current || !bestMove || thinking) return;
    const timer=setTimeout(()=>{
      const uci=bestMove;
      try{
        const next=new Chess(fen);next.move({from:uci.from,to:uci.to,promotion:uci.promotion||'q'});
        commitMove(uci.from,uci.to,uci.promotion||undefined);
      }catch{}
    },350);
    return ()=>clearTimeout(timer);
  },[computerTurn,bestMove,thinking,fen]);

  function playMoveSound(type){
    if(!soundOn || soundVolume===0) return;
    try{
      const AudioContextClass=window.AudioContext||window.webkitAudioContext;
      if(!AudioContextClass)return;
      const ctx=audioRef.current||(audioRef.current=new AudioContextClass());
      if(ctx.state==='suspended')ctx.resume();
      const now=ctx.currentTime;
      const presets={move:[520,0.055,'sine'],capture:[260,0.11,'triangle'],check:[880,0.16,'sawtooth'],mate:[660,0.28,'triangle']};
      const [freq,duration,wave]=presets[type]||presets.move;
      const osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.type=wave;osc.frequency.setValueAtTime(freq,now);
      if(type==='check'||type==='mate')osc.frequency.exponentialRampToValueAtTime(freq*0.72,now+duration);
      gain.gain.setValueAtTime((soundVolume/100)*0.12,now);
      gain.gain.exponentialRampToValueAtTime(0.001,now+duration);
      osc.connect(gain);gain.connect(ctx.destination);osc.start(now);osc.stop(now+duration);
    }catch{}
  }

  function commitMove(from,to,promo){
    const g=new Chess(fen);
    try{
      const made=g.move({from,to,promotion:promo||'q'});
      if(!made)return;
      const soundType=g.isCheckmate()?'mate':g.isCheck()?'check':made.captured?'capture':'move';
      playMoveSound(soundType);
      const newMoves=[...moves.slice(0,historyIndex),...g.history({verbose:true}).slice(-1)];
      setMoves(newMoves);setHistoryIndex(newMoves.length);setSelected(null);setPromotion(null);setNotice(`${made.color==='w'?'Brancas':'Pretas'}: ${made.san}`);
    }catch{setNotice('Movimento ilegal. Escolha uma casa destacada.');}
  }

  function onSquareClick(square){
    if(promotion)return;
    if(game.isGameOver())return;
    if(gameMode==='computer' && turn!==humanColor)return;
    const piece=game.get(square);
    if(selected){
      const candidates=game.moves({square:selected,verbose:true}).filter(m=>m.to===square);
      if(candidates.length){
        if(candidates.some(m=>m.promotion))setPromotion({from:selected,to:square,color:turn});
        else commitMove(selected,square);
        return;
      }
    }
    if(piece && piece.color===turn){setSelected(square);setNotice(`Peça selecionada: ${square}`);}
    else {setSelected(null);setNotice('Selecione uma peça do lado que deve jogar.');}
  }

  function navigate(index){setHistoryIndex(clamp(index,0,moves.length));setSelected(null);setPromotion(null);}
  function restart(){setInitialFen('start');setMoves([]);setHistoryIndex(0);setSelected(null);setPromotion(null);setNotice('Partida reiniciada.');}
  function undo(){if(historyIndex>0)navigate(historyIndex-1);}
  function redo(){if(historyIndex<moves.length)navigate(historyIndex+1);}
  function loadFen(){try{const g=new Chess(fenInput.trim());setInitialFen(g.fen());setMoves([]);setHistoryIndex(0);setShowImport(false);setNotice('FEN carregado.');}catch(e){setNotice('FEN inválido: '+e.message);}}
  function loadPgn(){try{const g=new Chess();g.loadPgn(pgnInput);const h=g.history({verbose:true});setInitialFen('start');setMoves(h.map(m=>({from:m.from,to:m.to,promotion:m.promotion,san:m.san})));setHistoryIndex(h.length);setShowImport(false);setNotice('PGN carregado.');}catch(e){setNotice('PGN inválido: '+e.message);}}
  function exportPgn(){navigator.clipboard?.writeText(game.pgn()).then(()=>setNotice('PGN copiado.')).catch(()=>setNotice(game.pgn()||'Partida sem lances.'));}
  function flip(){setOrientation(c=>c==='w'?'b':'w');}
  function changeHumanColor(){setHumanColor(c=>c==='w'?'b':'w');setOrientation(c=>c==='w'?'b':'w');}

  const arrows=useMemo(()=>{
    const arr=[];
    if(showArrows && engineLines.length){
      engineLines.slice(0,showAlt?3:1).forEach((l,i)=>{const u=l.pv?.[0];if(u?.length>=4)arr.push({from:u.slice(0,2),to:u.slice(2,4),color:i===0?'#2d9bf0':'#36a66b',width:i===0?0.095:0.065});});
    }
    if(showThreats){
      const sideToAttack=turn;
      for(const rank of '12345678')for(const file of FILES){const sqr=file+rank;const p=game.get(sqr);if(p&&p.color!==sideToAttack){const attackers=game.attackers(sqr,sideToAttack);attackers.slice(0,1).forEach(from=>arr.push({from,to:sqr,color:'#e34e4e',width:.045,dash:true}));}}
    }
    return arr;
  },[engineLines,showArrows,showAlt,showThreats,fen]);

  const displaySquares=useMemo(()=>{const list=[];for(let r=0;r<8;r++)for(let f=0;f<8;f++){const file=orientation==='w'?f:7-f,rank=orientation==='w'?r:7-r;list.push({square:squareName(file,rank),file,rank,visualFile:f,visualRank:r});}return list;},[orientation]);
  const evalDisplay=mate!==null?`M${Math.abs(mate)}`:`${evalCp>=0?'+':''}${evalCp.toFixed(1)}`;
  const evalWhite=mate!==null?(mate>0?1:0):clamp(.5+evalCp/10,0,1);

  const refreshUserData = useCallback(async (user)=>{
    if(!user){setProfile(null);setSavedGames([]);setLeaderboard([]);setExercises([]);return;}
    const [p,g,l,e]=await Promise.all([
      supabase.from('profiles').select('id,display_name,username,show_in_leaderboard').eq('id',user.id).maybeSingle(),
      supabase.from('games').select('id,result,mode,engine_level,moves_count,created_at,pgn').eq('user_id',user.id).order('created_at',{ascending:false}).limit(30),
      supabase.from('leaderboard').select('user_id,display_name,games_played,wins,draws,losses,points').order('points',{ascending:false}).order('wins',{ascending:false}).limit(20),
      supabase.from('exercises').select('id,title,description,difficulty,fen,created_at').eq('is_public',true).order('created_at',{ascending:false}).limit(20)
    ]);
    if(p.data)setProfile(p.data);
    if(g.data)setSavedGames(g.data);
    if(l.data)setLeaderboard(l.data);
    if(e.data)setExercises(e.data);
  },[]);

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>{
      setSession(data.session);
      if(data.session?.user) refreshUserData(data.session.user);
    });
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,nextSession)=>{
      setSession(nextSession);
      if(nextSession?.user) setTimeout(()=>refreshUserData(nextSession.user),0);
      else refreshUserData(null);
    });
    return ()=>subscription.unsubscribe();
  },[refreshUserData]);

  async function handleAuthSubmit(event){
    event.preventDefault();setAuthBusy(true);setAuthMessage('');
    try{
      if(authMode==='signup'){
        const {data,error}=await supabase.auth.signUp({email:authEmail,password:authPassword,options:{data:{display_name:displayName.trim()||authEmail.split('@')[0]}}});
        if(error)throw error;
        if(data.session){setAuthOpen(false);setAuthMessage('Cadastro realizado.');}
        else setAuthMessage('Cadastro criado. Verifique seu e-mail para confirmar a conta e depois entre.');
      }else{
        const {error}=await supabase.auth.signInWithPassword({email:authEmail,password:authPassword});
        if(error)throw error;
        setAuthOpen(false);setAuthPassword('');
      }
    }catch(error){setAuthMessage(error.message||'Não foi possível autenticar.');}
    finally{setAuthBusy(false);}
  }

  async function handleSignOut(){
    const {error}=await supabase.auth.signOut();
    if(error)setNotice('Erro ao sair: '+error.message);
  }

  async function saveFinishedGame(){
    if(!session?.user||!game.isGameOver()||history.length===0)return;
    const pgn=game.pgn();
    const key=session.user.id+'|'+pgn;
    if(savedGameKeyRef.current===key)return;
    savedGameKeyRef.current=key;
    const draw=game.isDraw()||game.isStalemate();
    const winner=game.turn()==='w'?'b':'w';
    const result=draw?'draw':(gameMode==='computer'?(winner===humanColor?'win':'loss'):(winner==='w'?'win':'loss'));
    const {error}=await supabase.from('games').insert({
      user_id:session.user.id,initial_fen:initialFen,pgn,result,mode:gameMode,
      human_color:gameMode==='computer'?humanColor:null,engine_level:gameMode==='computer'?engineLevel:null,
      depth,moves_count:history.length,finished_at:new Date().toISOString()
    });
    if(error){savedGameKeyRef.current='';setNotice('Partida terminou, mas não foi salva: '+error.message);return;}
    setNotice('Partida salva no seu histórico.');
    refreshUserData(session.user);
  }

  useEffect(()=>{saveFinishedGame();},[session,game.isGameOver(),history.length,gameMode,humanColor,engineLevel,depth]);

  async function createExercise(){
    if(!session?.user){setAuthOpen(true);return;}
    if(exerciseTitle.trim().length<3){setNotice('Informe um título com pelo menos 3 caracteres.');return;}
    const {error}=await supabase.from('exercises').insert({
      creator_id:session.user.id,title:exerciseTitle.trim(),description:exerciseDescription.trim(),
      fen:game.fen(),solution_pgn:game.pgn(),difficulty:exerciseDifficulty,is_public:true
    });
    if(error){setNotice('Não foi possível publicar o exercício: '+error.message);return;}
    setExerciseTitle('');setExerciseDescription('');setNotice('Exercício publicado para os colegas.');
    refreshUserData(session.user);
  }

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark">♞</div><div><div className="brand-name">CHESS <span>LAB</span></div><div className="brand-sub">TREINAMENTO E ANÁLISE</div></div></div><div className="top-actions"><span className="engine-dot"/><span>{engineState}</span>{session?<><span className="signed-user">{profile?.display_name||session.user.email}</span><button className="icon-button" onClick={handleSignOut}>Sair</button></>:<button className="icon-button" onClick={()=>{setAuthMode('login');setAuthOpen(true);}}>Entrar / Cadastrar</button>}<button className="icon-button" title="Configurações">⚙</button></div></header>
    <main className="workspace">
      <section className="board-column">
        <div className="player-row"><div className="avatar black">♚</div><div><strong>PRETAS</strong><small>{gameMode==='computer'&&humanColor==='b'?'Você':'Treinamento'}</small></div><span className="player-rating">—</span></div>
        <div className="board-wrap">
          <div className="eval-bar"><div className="eval-black" style={{height:`${(1-evalWhite)*100}%`}}/><div className="eval-label">{evalDisplay}</div></div>
          <div className="board" role="grid" aria-label="Tabuleiro de xadrez">
            <svg className="arrow-layer" viewBox="0 0 8 8" preserveAspectRatio="none">
              <defs>{arrows.map((a,i)=><marker key={i} id={`arrow-${i}`} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L5,2.5 L0,5 z" fill={a.color}/></marker>)}</defs>
              {arrows.map((a,i)=>{const p1=squareXY(a.from),p2=squareXY(a.to);if(orientation==='b'){p1.x=8-p1.x;p1.y=8-p1.y;p2.x=8-p2.x;p2.y=8-p2.y;}return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={a.color} strokeWidth={a.width} strokeLinecap="round" strokeDasharray={a.dash?'0.12 0.08':'none'} markerEnd={`url(#arrow-${i})`} opacity=".9"/>;})}
            </svg>
            {displaySquares.map(({square,file,rank,visualFile,visualRank})=>{
              const piece=game.get(square),isLight=(file+rank)%2===0,isLast=lastMove&&(lastMove.from===square||lastMove.to===square),isSelected=selected===square,isTarget=legalTargets.has(square);
              return <button key={square} className={`square ${isLight?'light':'dark'} ${isLast?'last':''} ${isSelected?'selected':''} ${isTarget?'target':''}`} onClick={()=>onSquareClick(square)} aria-label={square}>
                {visualFile===0&&<span className="coord rank">{8-rank}</span>}{visualRank===7&&<span className="coord file">{FILES[file]}</span>}
                {piece&&<span className={`piece ${piece.color==='w'?'white-piece':'black-piece'}`}>{PIECES[piece.color+piece.type]}</span>}
                {isTarget&&<span className={`move-dot ${piece?'capture':''}`}/>}
              </button>;
            })}
          </div>
        </div>
        <div className="player-row bottom-player"><div className="avatar white">♔</div><div><strong>BRANCAS</strong><small>{gameMode==='computer'&&humanColor==='w'?'Você':'Treinamento'}</small></div><span className="player-rating">—</span></div>
        <div className="board-controls"><button onClick={()=>navigate(0)} title="Início">|◀</button><button onClick={undo} disabled={historyIndex===0} title="Voltar">‹</button><button onClick={redo} disabled={historyIndex===moves.length} title="Avançar">›</button><button onClick={()=>navigate(moves.length)} title="Fim">▶|</button><span className="control-spacer"/><button onClick={flip} title="Girar tabuleiro">↻ Girar</button><button onClick={changeHumanColor} title="Alternar seu lado">Você joga de: {humanColor==='w'?'BRANCAS':'PRETAS'}</button><button onClick={restart} title="Reiniciar">↺ Reiniciar</button></div>
        <div className="sound-controls"><label><input type="checkbox" checked={soundOn} onChange={e=>setSoundOn(e.target.checked)}/> Sons</label><span>Volume</span><input aria-label="Volume dos efeitos sonoros" type="range" min="0" max="100" value={soundVolume} onChange={e=>setSoundVolume(Number(e.target.value))}/><button onClick={()=>playMoveSound('move')} disabled={!soundOn||soundVolume===0}>Testar</button></div>
        <div className="status-line"><span className={`status-indicator ${game.isCheck()?'danger':''}`}/>{status}<span className="status-note">{notice}</span></div>
      </section>

      <aside className="analysis-column">
        <div className="panel-tabs"><button className="active">◉ <span>Análise</span></button><button onClick={exportPgn}>▤ <span>Partida</span></button><button onClick={()=>setShowImport(v=>!v)}>⌕ <span>Explorar</span></button></div>
        <div className="analysis-heading"><div><strong>ANÁLISE DA POSIÇÃO</strong><small>Stockfish 19 Lite · MultiPV 5</small></div><label className="switch"><input type="checkbox" checked={analysisOn} onChange={e=>setAnalysisOn(e.target.checked)}/><span/></label></div>
        <div className="eval-summary"><div><small>AVALIAÇÃO</small><strong className={evalCp>=0?'positive':'negative'}>{evalDisplay}</strong><span>{mate!==null?'Mate previsto':evalCp>0.3?'Vantagem das brancas':evalCp<-.3?'Vantagem das pretas':'Posição equilibrada'}</span></div><div><small>PROFUNDIDADE</small><strong>{engineLines[0]?.depth||'—'}</strong><span>plies calculados</span></div></div>
        <div className="lines-heading"><strong>Melhores continuações</strong><span>{thinking?'Calculando…':analysisOn?'Atualizado':'Pausado'}</span></div>
        <div className="lines-list">
          {[1,2,3].map(n=>{const l=engineLines.find(x=>x.multipv===n);return <div className={`line-card line-${n}`} key={n}><div className="line-top"><span className="line-number">{n}</span><strong>{l?(l.mate!==null?`M${l.mate}`:`${l.score>=0?'+':''}${l.score?.toFixed(2)}`):'—'}</strong><small>{l?`prof. ${l.depth}`:'Aguardando engine'}</small></div><div className="variation">{l?pvToSan(fen,l.pv):'—'}</div>{l&&<button className="play-line" onClick={()=>{const g=new Chess(fen);let san=[];for(const u of l.pv.slice(0,8)){try{const m=g.move({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4]||'q'});if(m)san.push(m.san);}catch{break;}}setNotice('Linha: '+san.join(' '));}}>Ver linha ↗</button>}</div>;})}
        </div>
        <div className="section-divider"/>
        <div className="tools-heading"><strong>Visualização do tabuleiro</strong></div>
        <div className="toggle-row"><label><input type="checkbox" checked={showArrows} onChange={e=>setShowArrows(e.target.checked)}/> Melhores lances <i className="legend blue"/></label><label><input type="checkbox" checked={showAlt} onChange={e=>setShowAlt(e.target.checked)}/> Linhas alternativas <i className="legend green"/></label><label><input type="checkbox" checked={showThreats} onChange={e=>setShowThreats(e.target.checked)}/> Ameaças imediatas <i className="legend red"/></label></div>
        <div className="section-divider"/>
        <div className="tools-heading"><strong>Nível de treinamento</strong><span>Força {engineLevel}/5</span></div>
        <div className="engine-levels">
          {[1,2,3,4,5].map(level=><button key={level} className={engineLevel===level?'active':''} onClick={()=>setEngineLevel(level)} aria-pressed={engineLevel===level}><strong>{level}</strong><small>{['Passivo','Fácil','Médio','Forte','Máximo'][level-1]}</small></button>)}
        </div>
        <div className="level-description">{[
          'Nível 1 · Escolhe lances mais fracos entre as 5 melhores opções, com margem de até 2,0 peões.',
          'Nível 2 · Alterna entre opções razoáveis, com margem de até 1,2 peões.',
          'Nível 3 · Joga de forma consistente, com margem de até 0,7 peão.',
          'Nível 4 · Quase sempre escolhe a melhor opção, com margem de até 0,3 peão.',
          'Nível 5 · Prioriza sempre o melhor lance encontrado pelo Stockfish.'
        ][engineLevel-1]}</div>
        <div className="section-divider"/>
        <div className="tools-heading"><strong>Profundidade da análise</strong><span>{depth} plies</span></div>
        <input className="depth-slider" type="range" min="10" max="22" step="1" value={depth} onChange={e=>setDepth(Number(e.target.value))}/>
        <div className="depth-labels"><span>Rápida</span><span>Mais profunda</span></div>
        <div className="section-divider"/>
        <div className="moves-heading"><strong>Histórico de lances</strong><span>{moves.length} lances</span></div>
        <div className="move-list">{moves.length===0?<div className="empty-moves">A partida ainda não começou.</div>:Array.from({length:Math.ceil(moves.length/2)},(_,i)=><div className={`move-pair ${historyIndex===i*2+1||historyIndex===i*2+2?'current':''}`} key={i}><span>{i+1}.</span><button onClick={()=>navigate(i*2+1)}>{moves[i*2]?.san||`${moves[i*2]?.from}–${moves[i*2]?.to}`}</button><button onClick={()=>moves[i*2+1]&&navigate(i*2+2)}>{moves[i*2+1]?.san||''}</button></div>)}</div>
        <div className="panel-footer"><button onClick={()=>setShowImport(v=>!v)}>＋ FEN / PGN</button><button onClick={exportPgn}>⇩ Exportar PGN</button><button onClick={()=>setGameMode(m=>m==='both'?'computer':'both')}>{gameMode==='both'?'♟ Jogar contra engine':'⇄ Jogar os dois lados'}</button></div>
        {showImport&&<div className="import-box"><div className="import-head"><strong>Importar posição ou partida</strong><button onClick={()=>setShowImport(false)}>×</button></div><label>FEN<input value={fenInput} onChange={e=>setFenInput(e.target.value)} placeholder="Cole uma posição FEN"/></label><button onClick={loadFen}>Carregar FEN</button><label>PGN<textarea value={pgnInput} onChange={e=>setPgnInput(e.target.value)} placeholder="Cole a notação PGN"/></label><button onClick={loadPgn}>Carregar PGN</button></div>}
      </aside>
    </main>
    {authOpen&&<div className="modal-backdrop"><form className="auth-modal" onSubmit={handleAuthSubmit}>
      <div className="import-head"><strong>{authMode==='login'?'Entrar no Chess Lab':'Criar conta'}</strong><button type="button" onClick={()=>setAuthOpen(false)}>×</button></div>
      {authMode==='signup'&&<label>Nome de exibição<input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Como aparecerá no ranking" maxLength={40}/></label>}
      <label>E-mail<input type="email" required autoComplete="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} placeholder="voce@email.com"/></label>
      <label>Senha<input type="password" required minLength={6} autoComplete={authMode==='login'?'current-password':'new-password'} value={authPassword} onChange={e=>setAuthPassword(e.target.value)} placeholder="Mínimo de 6 caracteres"/></label>
      {authMessage&&<p className="auth-message">{authMessage}</p>}
      <button className="auth-submit" disabled={authBusy}>{authBusy?'Aguarde…':authMode==='login'?'Entrar':'Criar conta'}</button>
      <button type="button" className="auth-switch" onClick={()=>{setAuthMode(v=>v==='login'?'signup':'login');setAuthMessage('');}}>{authMode==='login'?'Ainda não tem conta? Cadastre-se':'Já tem conta? Entrar'}</button>
    </form></div>}
    {session&&<section className="dashboard-panel">
      <div className="dashboard-head"><div><strong>PAINEL DO JOGADOR</strong><small>{profile?.display_name||session.user.email} · dados sincronizados na nuvem</small></div>
        <div className="dashboard-tabs"><button className={dashboardTab==='history'?'active':''} onClick={()=>setDashboardTab('history')}>Partidas</button><button className={dashboardTab==='ranking'?'active':''} onClick={()=>setDashboardTab('ranking')}>Ranking</button><button className={dashboardTab==='exercises'?'active':''} onClick={()=>setDashboardTab('exercises')}>Exercícios</button></div>
      </div>
      {dashboardTab==='history'&&<div className="dashboard-content">
        <div className="stat-grid"><div><small>PARTIDAS</small><strong>{savedGames.length}</strong></div><div><small>VITÓRIAS</small><strong>{savedGames.filter(g=>g.result==='win').length}</strong></div><div><small>EMPATES</small><strong>{savedGames.filter(g=>g.result==='draw').length}</strong></div><div><small>DERROTAS</small><strong>{savedGames.filter(g=>g.result==='loss').length}</strong></div></div>
        <div className="dashboard-list">{savedGames.length===0?<p className="empty-moves">Suas partidas concluídas aparecerão aqui automaticamente.</p>:savedGames.map(g=><div className="dashboard-row" key={g.id}><span className={'result-dot '+g.result}/><strong>{g.result==='win'?'Vitória':g.result==='loss'?'Derrota':g.result==='draw'?'Empate':'Em andamento'}</strong><small>{g.mode==='computer'?'Contra engine':'Análise / dois lados'} · {g.moves_count} lances · {new Date(g.created_at).toLocaleDateString('pt-BR')}</small></div>)}</div>
      </div>}
      {dashboardTab==='ranking'&&<div className="dashboard-list">{leaderboard.length===0?<p className="empty-moves">Ainda não há resultados no ranking.</p>:leaderboard.map((p,i)=><div className="dashboard-row" key={p.user_id}><span className="rank-number">{i+1}</span><strong>{p.display_name}{p.user_id===session.user.id?' (você)':''}</strong><small>{p.points} pts · {p.wins} vitórias · {p.games_played} partidas</small></div>)}</div>}
      {dashboardTab==='exercises'&&<div className="dashboard-content"><div className="exercise-create"><strong>Publicar posição atual como exercício</strong><input value={exerciseTitle} onChange={e=>setExerciseTitle(e.target.value)} placeholder="Título do exercício"/><input value={exerciseDescription} onChange={e=>setExerciseDescription(e.target.value)} placeholder="Descrição / objetivo (opcional)"/><select value={exerciseDifficulty} onChange={e=>setExerciseDifficulty(e.target.value)}><option value="beginner">Iniciante</option><option value="intermediate">Intermediário</option><option value="advanced">Avançado</option></select><button onClick={createExercise}>Publicar posição atual</button></div>
      <div className="dashboard-list">{exercises.length===0?<p className="empty-moves">Nenhum exercício público ainda.</p>:exercises.map(ex=><div className="dashboard-row" key={ex.id}><strong>{ex.title}</strong><small>{ex.difficulty==='beginner'?'Iniciante':ex.difficulty==='advanced'?'Avançado':'Intermediário'} · {ex.description||'Sem descrição'}</small><button onClick={()=>{try{const g=new Chess(ex.fen);setInitialFen(g.fen());setMoves([]);setHistoryIndex(0);setNotice('Posição do exercício carregada.');}catch{setNotice('FEN deste exercício inválido.');}}}>Carregar posição</button></div>)}</div></div>}
    </section>}
    {promotion&&<div className="modal-backdrop"><div className="promotion-modal"><strong>Escolha a peça para promoção</strong><div>{['q','r','b','n'].map(t=><button key={t} onClick={()=>commitMove(promotion.from,promotion.to,t)}>{PIECES[promotion.color+t]}</button>)}</div><button className="cancel" onClick={()=>setPromotion(null)}>Cancelar</button></div></div>}
    <footer className="footer">CHESS LAB <span>·</span> Análise local no navegador <span>·</span> Versão 1.0</footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
