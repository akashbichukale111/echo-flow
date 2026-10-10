
const IMG={
 "city": "assets/city-system.webp",
 "drought": "assets/04-drought.webp",
 "flood": "assets/02-floods.webp",
 "ground": "assets/07-groundwater.webp",
 "heat": "assets/01-heatwaves.webp",
 "monsoon": "assets/03-waterlogging.webp",
 "leak": "assets/06-leaks.webp",
 "tanker": "assets/05-tankers.webp",
 "sysEcho": "assets/card-echo-flow.webp",
 "sysRahat": "assets/card-rahat.webp",
 "sysWater": "assets/card-waterpulse.webp"
};
const $=s=>document.querySelector(s),RM=matchMedia('(prefers-reduced-motion:reduce)').matches;
const NODES=[['🌡','HEAT',['Thermal exposure rising','Relief routing available'],880,300],['⚡','POWER',['Cooling demand building','Decision dependency: transformers'],1120,520],['💧','WATER',['Supply stress detected','Decision dependency: pumps'],1350,480],['🌊','FLOOD',['Surface water rising','Response window active'],1000,700],['🏥','CRITICAL SERVICES',['Access depends on power, water, roads','Priority for response'],1650,500],['🚗','ROADS',['Corridors carry the response','Closure risk feeds decisions'],1070,545],['⚙','PUMPS',['Water and drainage capacity','Needs power to operate'],1190,650]];
const NE=[[0,1],[1,6],[6,2],[2,4],[3,5],[3,4]];
let NXY=[];
$('#nodes').innerHTML=NODES.map((n,i)=>`<div class="nd" tabindex="0" data-i="${i}" role="note" aria-label="${n[1]}: ${n[2][0]}. ${n[2][1]}"><div class="dot">${n[0]}</div><div class="lb">${n[1]=='CRITICAL SERVICES'?'SERVICES':n[1]}</div><div class="gl"></div><div class="tip"><b>${n[1]}</b><span>${n[2][0]}</span><span>${n[2][1]}</span><span style="color:var(--or)">Conceptual indicator</span></div></div>`).join('');
$('#nl').innerHTML=NE.map(e=>`<path data-a="${e[0]}" data-b="${e[1]}"/>`).join('');
const ND=[...document.querySelectorAll('.nd')],NP=[...document.querySelectorAll('#nl path')];
function placeNodes(){const xy=NODES.map(n=>[MX+n[3]*MS,MY+n[4]*MS]);ND.forEach((d,i)=>{const [x,y]=xy[i];d.style.left=x+'px';d.style.top=y+'px';d.classList.toggle('rt',x>W-170);d.style.display=x>16&&x<W-16&&y>70&&y<H-16&&(W>700||y>H*.83)?'':'none'});NXY=xy.map((p,i)=>ND[i].style.display=='none'?null:p);NP.forEach(p=>{const a=xy[+p.dataset.a],b=xy[+p.dataset.b];p.setAttribute('d',`M${a[0]} ${a[1]}Q${(a[0]+b[0])/2} ${Math.min(a[1],b[1])-40} ${b[0]} ${b[1]}`)})}
function scanNode(i,on){ND[i]&&ND[i].classList.toggle('scan',on);NP.forEach(p=>p.classList.toggle('hl',on&&(+p.dataset.a==i||+p.dataset.b==i)))}
ND.forEach(d=>{const i=+d.dataset.i,f=on=>NP.forEach(p=>p.classList.toggle('hl',on&&(+p.dataset.a==i||+p.dataset.b==i)));d.onmouseenter=d.onfocus=()=>f(1);d.onmouseleave=d.onblur=()=>f(0)});
const SYS=[['ECHO-FLOW','/echo-flow','#38d6ff','sysEcho','Test the response before the consequence becomes a cascade.'],['RAHAT','/rahat','#ff9a3c','sysRahat','Navigate through heat, not just distance.'],['WATERPULSE','/waterpulse','#3dffd0','sysWater','Detect water stress before the city runs dry.']];
$('#sys').innerHTML=SYS.map(s=>`<div class="sysw rv" style="--ac:${s[2]}"><a class="card" href="${s[1]}/" aria-label="Enter ${s[0]}"><div class="im lz" data-k="${s[3]}" style="background-position:center;background-size:cover"></div></a><div class="scap"><p>${s[4]}</p><a class="btn" href="${s[1]}/" style="border-color:${s[2]};color:${s[2]}">ENTER ${s[0]} <span class="ar">→</span></a></div></div>`).join('');
const CH=[['HEATWAVES','RAHAT','#ff9a3c','heat'],['FLOODS','ECHO-FLOW','#38d6ff','flood'],['MONSOON WATERLOGGING','ECHO-FLOW','#38d6ff','monsoon'],['DROUGHT & WATER SHORTAGE','WATERPULSE','#3dffd0','drought'],['WATER TANKERS','WATERPULSE','#3dffd0','tanker'],['WATER LEAKS','WATERPULSE','#3dffd0','leak'],['GROUNDWATER','WATERPULSE','#3dffd0','ground']];
$('#chg').innerHTML=CH.map((c,i)=>`<a class="ch rv" href="/${c[1].toLowerCase()}/" aria-label="${i+1}. ${c[0]} — ${c[1]}" style="--ac:${c[2]}"><div class="im lz" data-k="${c[3]}" style="background-position:center;background-size:cover"></div></a>`).join('');
$('#lgd').innerHTML=[['RAHAT','#ff9a3c','1 challenge · Heatwaves'],['ECHO-FLOW','#38d6ff','2 challenges · Floods, Waterlogging'],['WATERPULSE','#3dffd0','4 challenges · Drought, Tankers, Leaks, Groundwater']].map(l=>`<a href="#enter" style="--ac:${l[1]}"><i></i><b>${l[0]}</b><span>${l[2]}</span></a>`).join('');
document.querySelectorAll('.ch').forEach(c=>{c.addEventListener('pointermove',e=>{if(RM||e.pointerType!='mouse')return;const r=c.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;c.style.transform=`translateY(-8px) perspective(900px) rotateY(${x*6}deg) rotateX(${-y*6}deg)`});c.addEventListener('pointerleave',()=>c.style.transform='')});
// city system: supplied image + code-drawn connections
$('#cityimg').classList.add('lz');$('#cityimg').dataset.k='city';
const G=[['HEAT',195,190],['POWER',462,303],['HOSPITALS',869,206],['WATER',1200,308],['FLOOD / RIVER',1638,140],['ROADS',1608,445],['RAINFALL',924,552],['SHELTERS',347,590]];
const E=[[0,1],[1,2],[2,3],[3,4],[3,5],[6,3],[6,5],[7,1],[2,6],[0,7]];
const dd=e=>{const A=G[e[0]],B=G[e[1]];return `M${A[1]} ${A[2]}Q${(A[1]+B[1])/2} ${Math.min(A[2],B[2])-90} ${B[1]} ${B[2]}`};
$('#sv').innerHTML=E.map(e=>`<path class="ed" data-a="${e[0]}" data-b="${e[1]}" d="${dd(e)}" fill="none" stroke="rgba(120,225,255,.45)" stroke-width="3"/>`).join('')+(RM?'':E.map((e,i)=>`<circle r="7" fill="#ffb25c" style="filter:drop-shadow(0 0 6px #ff9a3c)"><animateMotion dur="${3.5+i%4}s" begin="${i*.4}s" repeatCount="indefinite" path="${dd(e)}"/></circle>`).join(''))+G.map((g,i)=>`<g class="gn" data-i="${i}" style="cursor:pointer"><circle cx="${g[1]}" cy="${g[2]}" r="52" fill="none" stroke="#38d6ff" stroke-width="2" opacity=".5">${RM?'':'<animate attributeName="r" values="46;78;46" dur="3.2s" repeatCount="indefinite"/><animate attributeName="opacity" values=".6;0;.6" dur="3.2s" repeatCount="indefinite"/>'}</circle><circle cx="${g[1]}" cy="${g[2]}" r="56" fill="transparent"/><rect x="${g[1]-g[0].length*8-12}" y="${g[2]+62}" width="${g[0].length*16+24}" height="34" rx="8" fill="rgba(5,11,20,.78)" stroke="rgba(120,200,255,.4)"/><text x="${g[1]}" y="${g[2]+86}">${g[0]}</text></g>`).join('');
document.querySelectorAll('.gn').forEach(n=>{const i=+n.dataset.i,f=on=>document.querySelectorAll('#sv .ed').forEach(l=>{const h=+l.dataset.a==i||+l.dataset.b==i;l.setAttribute('stroke',on&&h?'#ff9a3c':'rgba(120,225,255,.45)');l.setAttribute('stroke-width',on&&h?6:3)});n.onmouseenter=()=>f(1);n.onmouseleave=()=>f(0)});
const CHN=[['🌡 Heat','Power Demand','Transformer Stress','Power Availability','Pump Capacity','Water Availability','Critical Service Risk'],['🌧 Rainfall','Flood','Road Closure','Hospital Access','Emergency Response']];
$('#chains').innerHTML=CHN.map(r=>`<div class="chain">${r.map((t,i)=>`<span style="--d:${i*.9}s">${t}</span>`).join('<i>→</i>')}</div>`).join('');
const ST=[['🌍','EARTH','The living environment',150],['🛰','OBSERVE','Earth observation',450],['🧠','INTELLIGENCE','Signals become understanding',750],['🌱','DECISION','A resilient, human-authorized city',1050]];
$('#st').innerHTML=`<path d="M150 120H1050" stroke="rgba(120,225,255,.35)" stroke-width="2" stroke-dasharray="6 8"/>`+(RM?'':`<circle r="6" fill="#ffb25c"><animateMotion dur="7s" repeatCount="indefinite" path="M150 120H1050"/></circle>`)+ST.map(s=>`<g><circle cx="${s[3]}" cy="120" r="54" fill="#07101c" stroke="#38d6ff" stroke-opacity=".6" stroke-width="1.5"/><text x="${s[3]}" y="134" class="em">${s[0]}</text><text x="${s[3]}" y="205" class="t1">${s[1]}</text><text x="${s[3]}" y="230" class="t2">${s[2]}</text></g>`).join('')+['💧','🌡','🌊'].map((e,i)=>`<text x="${540+i*60}" y="${i==1?190:60}" class="sg">${e}</text>`).join('');
// pipeline
const P=['Observe','Understand','Find Options','Simulate','Compare','Challenge','Verify','Human Decision','Act','Re-evaluate'];
$('#pipe').innerHTML=P.map((p,i)=>`<div class="s${p=='Human Decision'?' hum':''}"><b>${String(i+1).padStart(2,'0')}</b>${p}</div>`).join('');
let pi=0;const ps=[...document.querySelectorAll('.pipe .s')];function tick(){ps.forEach((s,i)=>s.classList.toggle('on',i==pi));$('#pb').style.width=(pi+1)*10+'%';pi=(pi+1)%10}tick();if(!RM)setInterval(tick,1100);
const lio=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.style.backgroundImage=`url(${IMG[e.target.dataset.k]})`;lio.unobserve(e.target)}}),{rootMargin:'700px'});document.querySelectorAll('.lz').forEach(e=>lio.observe(e));
// routes (placeholders)
const NAMES={'/echo-flow':['ECHO-FLOW','Flood & Emergency Decision Intelligence'],'/rahat':['RAHAT','Heatwave & Thermal Relief Intelligence'],'/waterpulse':['WATERPULSE','Water Security & Shortage Intelligence']};
const home=$('#app'),ph=document.createElement('div');ph.style.cssText='min-height:100svh;display:none;place-items:center;text-align:center;padding:120px 5vw';document.body.insertBefore(ph,home);
const BG={'/echo-flow':'flood','/rahat':'heat','/waterpulse':'ground'};
function route(){const r=location.hash.slice(1);if(NAMES[r]){home.style.display='none';ph.style.display='grid';ph.style.background=`linear-gradient(180deg,#050b14 0%,#050b14 24%,rgba(5,11,20,.55) 55%,rgba(5,11,20,.85) 100%),url(${IMG[BG[r]]}) center bottom/cover`;ph.innerHTML=`<div><div class="eye">System page · placeholder</div><h2 style="font-size:clamp(40px,8vw,96px)">${NAMES[r][0]}</h2><p style="color:#c3d3e4;margin:6px 0 26px">${NAMES[r][1]}<br>The internal dashboard is built in a later step.</p><a class="btn p" href="#modes">← BACK TO MODES</a></div>`;scrollTo(0,0)}else{home.style.display='';ph.style.display='none';const el=r&&r!='home'?$('#'+r):null;if(el)el.scrollIntoView();else if(!r||r=='home')scrollTo(0,0)}}
addEventListener('hashchange',route);
// nav
(function(){const g=(r,n,col)=>Array.from({length:n},(_,i)=>{const a=i/n*6.283+Math.random()*.3;return `<circle cx="${(Math.cos(a)*r).toFixed(1)}" cy="${(Math.sin(a)*r).toFixed(1)}" r="${(1.2+Math.random()*1.4).toFixed(1)}" fill="${col}"/>`}).join(''),m=innerWidth<700?7:16;$('#ring').innerHTML=`<g class="r1"><circle r="250" fill="none" stroke="rgba(120,235,255,.4)" stroke-dasharray="1.5 11"/><circle r="215" fill="none" stroke="rgba(52,224,161,.3)" stroke-dasharray="46 16 4 16"/><path d="M250 0A250 250 0 0 1 0 250" fill="none" stroke="rgba(52,224,161,.55)" stroke-width="1.5"/>${g(250,m,'#7fe8ff')}${g(215,m,'#5af0aa')}</g><g class="r2"><circle r="170" fill="none" stroke="rgba(120,235,255,.25)" stroke-dasharray="1 7"/><path d="M-170 0A170 170 0 0 1 0 -170" fill="none" stroke="rgba(120,235,255,.5)"/>${g(170,Math.round(m/2),'#bff6ff')}</g>`})();
const dim=$('#dim');addEventListener('scroll',()=>{dim.style.opacity=Math.min(1,scrollY/(innerHeight*.8))*.8},{passive:true});
const nav=$('#nav');addEventListener('scroll',()=>nav.classList.toggle('sc',scrollY>40),{passive:true});
$('#menu').onclick=()=>$('#links').classList.toggle('open');$('#links').onclick=()=>$('#links').classList.remove('open');
// reveal + counters
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.12});document.querySelectorAll('.rv').forEach(e=>io.observe(e));
new IntersectionObserver((es,o)=>{if(es[0].isIntersecting){o.disconnect();document.querySelectorAll('[data-n]').forEach(b=>{const t=+b.dataset.n;let v=0;const id=setInterval(()=>{b.textContent=++v;if(v>=t)clearInterval(id)},RM?1:140)})}}).observe($('#met'));
route();
// parallax
const bg=$('#bg');if(!RM&&matchMedia('(pointer:fine)').matches)$('#home').addEventListener('mousemove',e=>{const x=e.clientX/innerWidth-.5,y=e.clientY/innerHeight-.5;bg.style.transform=`translate(${-x*14}px,${-y*8}px)`});
// particles
const fx=$('#fx'),c=fx.getContext('2d');let W,H,pts=[],MS=1,MX=0,MY=0;
const RIV=[[[1050,330],[1160,318],[1320,410],[1440,480],[1475,570],[1440,625],[1330,595],[1250,505],[1100,420]],[[400,645],[560,612],[900,592],[1010,625],[1150,655],[1235,720],[1120,792],[700,802],[430,722]]];
const inP=(p,x,y)=>{let c=false;for(let i=0,j=p.length-1;i<p.length;j=i++)if((p[i][1]>y)!=(p[j][1]>y)&&x<(p[j][0]-p[i][0])*(y-p[i][1])/(p[j][1]-p[i][1])+p[i][0])c=!c;return c};
const SP=[];for(let n=0;SP.length<(innerWidth<700?40:100);n++){const p=RIV[n%2],x=380+Math.random()*1100,y=310+Math.random()*500;if(inP(p,x,y))SP.push({x,y,ph:Math.random()*6.28,sp:.5+Math.random()*1.3,l:8+Math.random()*18})}
function mapImg(){MS=Math.max(1.04*W/1944,1.04*H/809);MX=-.02*W+(1.04*W-1944*MS)*.55;MY=-.02*H+(1.04*H-809*MS)*.6}
function rs(){W=fx.width=fx.clientWidth;H=fx.height=fx.clientHeight;mapImg();placeNodes();pts=Array.from({length:Math.min(60,W/22)},()=>({x:Math.random()*W,y:Math.random()*H,r:Math.random()*1.4+.4,v:Math.random()*.25+.05,a:Math.random()*.5+.2,g:Math.random()<.35,l:Math.random()<.1}))}rs();new ResizeObserver(rs).observe(fx);
const TR=[[[1040,560],[1250,620],[1450,690],[1700,770]],[[1440,470],[1500,540],[1540,600]],[[270,640],[480,610],[590,570]],[[1000,370],[1120,362],[1250,355]]];
const LT=Array.from({length:innerWidth<700?10:22},(_,i)=>({p:i%TR.length,t:Math.random(),v:.0006+Math.random()*.0012}));
function pt(P,t){const L=[];let tot=0;for(let i=1;i<P.length;i++){const l=Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]);L.push(l);tot+=l}let d=t*tot;for(let i=0;i<L.length;i++){if(d<=L[i]){const k=d/L[i];return[P[i][0]+(P[i+1][0]-P[i][0])*k,P[i][1]+(P[i+1][1]-P[i][1])*k]}d-=L[i]}return P[P.length-1]}
function TRAIL(){for(const q of LT){q.t+=q.v;if(q.t>1)q.t=0;const a=pt(TR[q.p],q.t),b=pt(TR[q.p],Math.max(0,q.t-.04)),al=Math.sin(q.t*Math.PI)*.85;c.strokeStyle=q.p%2?`rgba(255,178,92,${al})`:`rgba(255,244,220,${al})`;c.lineWidth=2;c.lineCap='round';c.beginPath();c.moveTo(MX+b[0]*MS,MY+b[1]*MS);c.lineTo(MX+a[0]*MS,MY+a[1]*MS);c.stroke()}}
const RV=[[1120,360],[1230,410],[1310,470],[1380,530],[1440,590]];
function RIVERFX(){const t=performance.now()/1000;c.save();c.lineWidth=1;c.setLineDash([16,30]);for(let k=-1;k<=1;k++){c.lineDashOffset=-t*18-k*9;c.strokeStyle=`rgba(130,240,255,${k?.16:.26})`;c.beginPath();RV.forEach((p,i)=>{const x=MX+p[0]*MS,y=MY+(p[1]+k*16)*MS;i?c.lineTo(x,y):c.moveTo(x,y)});c.stroke()}c.restore();const u=(t*.06)%1;if(u<.75){const [x,y]=pt(RV,u/.75);c.fillStyle='rgba(190,250,255,.9)';c.beginPath();c.arc(MX+x*MS,MY+y*MS,2.6,0,7);c.fill();c.fillStyle='rgba(120,235,255,.25)';c.beginPath();c.arc(MX+x*MS,MY+y*MS,7,0,7);c.fill()}}
function PULSES(){const t=performance.now()/1000;NE.forEach((e,i)=>{const a=NXY[e[0]],b=NXY[e[1]];if(!a||!b)return;const u=(t*.16+i*.29)%1,m=[(a[0]+b[0])/2,Math.min(a[1],b[1])-40],x=(1-u)*(1-u)*a[0]+2*(1-u)*u*m[0]+u*u*b[0],y=(1-u)*(1-u)*a[1]+2*(1-u)*u*m[1]+u*u*b[1];c.fillStyle=i%2?'rgba(90,240,170,.95)':'rgba(120,235,255,.95)';c.beginPath();c.arc(x,y,2.4,0,7);c.fill();c.fillStyle='rgba(120,235,255,.2)';c.beginPath();c.arc(x,y,6,0,7);c.fill()})}
let vis=true;new IntersectionObserver(e=>vis=e[0].isIntersecting).observe($('#home'));
(function loop(){if(vis&&!RM){c.clearRect(0,0,W,H);for(const p of pts){p.y-=p.v;p.x+=Math.sin(p.y/60)*.15;if(p.y<0){p.y=H;p.x=Math.random()*W}c.fillStyle=p.g?`rgba(90,235,170,${p.a})`:`rgba(255,210,160,${p.a})`;c.beginPath();p.l?c.ellipse(p.x,p.y,p.r*3,p.r*1.2,p.y/40,0,7):c.arc(p.x,p.y,p.r,0,7);c.fill()}const t=performance.now()/1000;for(const q of SP){const a=Math.sin(t*q.sp+q.ph);if(a<.5)continue;const al=(a-.5)*1.6,x=MX+q.x*MS,y=MY+q.y*MS,l=q.l*MS;c.fillStyle=`rgba(210,243,255,${al})`;c.fillRect(x-l/2,y,l,1.6);c.fillStyle=`rgba(255,190,120,${al*.5})`;c.fillRect(x-l/4,y+3,l/2,1)}TRAIL();RIVERFX();PULSES()}requestAnimationFrame(loop)})();
// satellite
addEventListener('load',function(){if(!window.THREE||innerWidth<700)return;const cv=$('#sat'),R=new THREE.WebGLRenderer({canvas:cv,alpha:true,antialias:true});R.setPixelRatio(Math.min(devicePixelRatio,1.5));const S=new THREE.Scene(),C=new THREE.PerspectiveCamera(40,1,.1,100);C.position.set(0,0,12);
S.add(new THREE.AmbientLight(0x8899bb,.9));const L=new THREE.DirectionalLight(0xffc890,1.6);L.position.set(5,3,5);S.add(L);
const sat=new THREE.Group(),m=(g,col,e)=>new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:col,metalness:.7,roughness:.35,emissive:e||0,emissiveIntensity:.4}));
sat.add(m(new THREE.BoxGeometry(.7,.5,.5),0xc8d4e0));const ds=m(new THREE.CylinderGeometry(.18,.05,.15,16),0xdddddd);ds.position.y=.38;sat.add(ds);
[-1,1].forEach(s=>{const p=m(new THREE.BoxGeometry(1.5,.02,.6),0x1d4f9a,0x0a2a66);p.position.x=s*1.25;sat.add(p);const a=m(new THREE.BoxGeometry(.5,.03,.03),0x999999);a.position.x=s*.55;sat.add(a)});
sat.scale.setScalar(.42);S.add(sat);
const nv1=new THREE.Mesh(new THREE.SphereGeometry(.07,8,8),new THREE.MeshBasicMaterial({color:0xff4d4d})),nv2=new THREE.Mesh(new THREE.SphereGeometry(.07,8,8),new THREE.MeshBasicMaterial({color:0x4dff9a}));nv1.position.set(-2,0,.3);nv2.position.set(2,0,.3);sat.add(nv1,nv2);
const beam=new THREE.Mesh(new THREE.CylinderGeometry(.34,.02,1,20,1,true),new THREE.MeshBasicMaterial({color:0x7fe3ff,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide}));beam.visible=false;S.add(beam);const TG=new THREE.Vector3(.8,-1.6,0);const ring=new THREE.Mesh(new THREE.RingGeometry(.2,.23,40),new THREE.MeshBasicMaterial({color:0x7fe3ff,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}));ring.visible=false;S.add(ring);const pls=new THREE.Mesh(new THREE.SphereGeometry(.06,10,10),new THREE.MeshBasicMaterial({color:0xbff6ff}));pls.visible=false;S.add(pls);
const trail=new THREE.Points(new THREE.BufferGeometry().setFromPoints(Array.from({length:70},(_,i)=>{const a=i/70*6.283;return new THREE.Vector3(Math.cos(a)*4.4,Math.sin(a)*.3,Math.sin(a)*1.4)})),new THREE.PointsMaterial({color:0x7fd8ff,size:.04,transparent:true,opacity:.45}));trail.position.set(2.4,3.0,0);S.add(trail);
function rz(){const w=cv.clientWidth,h=cv.clientHeight;R.setSize(w,h,false);C.aspect=w/h;C.position.z=w/h<1?22:12;C.updateProjectionMatrix()}rz();addEventListener('resize',rz);let raf,lastC=-1,t=0,last=performance.now(),on=true;addEventListener('pagehide',()=>{cancelAnimationFrame(raf);R.dispose()});new IntersectionObserver(e=>on=e[0].isIntersecting).observe($('#home'));
(function f(n){raf=requestAnimationFrame(f);if(!on)return;const dt=Math.min((n-last)/1000,.05);last=n;if(!RM)t+=dt*.12;const a=t*6.283;
sat.position.set(2.4+Math.cos(a)*4.4,3.0+Math.sin(a)*.3,Math.sin(a)*1.4);sat.rotation.y=-a+Math.PI/2;sat.rotation.z=Math.sin(a)*.12;
const ts=n/1000,cyc=Math.floor(ts/16),ph=(ts%16)/16,zi=[0,3,2,1,4][cyc%5];nv1.visible=Math.sin(ts*4)>0;nv2.visible=Math.sin(ts*4+3)>0;
if(ph<.18&&!RM){if(lastC!=cyc){lastC=cyc;const nd=ND[zi],cw=cv.clientWidth,chh=cv.clientHeight;if(nd&&nd.style.display!='none')TG.set((parseFloat(nd.style.left)-cw/2)/(chh/2)*4.367,(chh/2-parseFloat(nd.style.top))/(chh/2)*4.367,0);scanNode(zi,true);setTimeout(()=>scanNode(zi,false),3200)}
const r=ph/.18,k=Math.sin(r*Math.PI);beam.visible=true;beam.material.opacity=.24*k;beam.position.copy(sat.position).lerp(TG,.5);beam.scale.set(1,sat.position.distanceTo(TG),1);beam.lookAt(TG);beam.rotateX(Math.PI/2);
ring.visible=r>.45;ring.position.copy(TG);ring.scale.setScalar(1+(r-.45)*5);ring.material.opacity=.6*(1-r);pls.visible=r<.6;pls.position.copy(sat.position).lerp(TG,Math.min(1,r/.6))}else{beam.visible=false;ring.visible=false;pls.visible=false}
R.render(S,C)})(last)});
