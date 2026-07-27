const {JSDOM,VirtualConsole}=require('/home/claude/node_modules/jsdom');
const fs=require('fs'),path=require('path');
const PUB=process.env.GAME_DIR ? require('path').join(process.env.GAME_DIR,'public') : require('path').join(__dirname,'..','public');
const g=process.argv[2];
/* بيحمّل صفحة اللعبة زي المتصفح ويمسك أي خطأ وقت التشغيل */
let html=fs.readFileSync(path.join(PUB,g,'index.html'),'utf8');
html=html.replace(/<script src="([^"]+)"><\/script>/g,(m,src)=>{
  const fp = src.startsWith('/') ? path.join(PUB,src) : path.join(PUB,g,src);
  return fs.existsSync(fp)?'<script>'+fs.readFileSync(fp,'utf8')+'</script>':'<!-- missing '+src+' -->';
});
const errs=[]; const vc=new VirtualConsole();
vc.on('jsdomError',e=>errs.push(e.message.split('\n')[0]));
new JSDOM(html,{runScripts:'dangerously',url:'https://x.test/',virtualConsole:vc,beforeParse(w){
  w.EventSource=function(){this.addEventListener=()=>{};this.close=()=>{}};
  w.fetch=()=>Promise.resolve({json:()=>Promise.resolve({ok:false})});
}});
console.log((errs.length?'❌ ':'✅ ')+g+(errs.length?'  '+errs.join(' | '):'  حمّلت نضيفة'));
process.exit(0);
