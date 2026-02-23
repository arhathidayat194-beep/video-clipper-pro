const { createFFmpeg, fetchFile } = FFmpeg;
const state = {
  ffmpeg:null, ffmpegReady:false, videoInfo:null,
  videoSource:null, processedClips:[],
  manualSegments:[{start:"00:00:00",end:"00:01:00"}], currentTab:"upload"
};
const pad = n => String(Math.floor(n)).padStart(2,"0");
function toHMS(s){return `${pad(s/3600)}:${pad((s%3600)/60)}:${pad(s%60)}`;}
function fmtDur(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60);if(h)return`${h}j ${m}m ${sec}d`;if(m)return`${m}m ${sec}d`;return`${sec} detik`;}
function fmtSize(b){if(b<1048576)return`${(b/1024).toFixed(1)} KB`;if(b<1073741824)return`${(b/1048576).toFixed(1)} MB`;return`${(b/1073741824).toFixed(2)} GB`;}
function timeToSec(s){const p=String(s||"").split(":").map(Number);if(p.length===3)return p[0]*3600+p[1]*60+(p[2]||0);if(p.length===2)return p[0]*60+(p[1]||0);return p[0]||0;}
function getExt(n){const u=(n||"").toLowerCase().split("?")[0];const m=u.match(/\.(mp4|webm|mov|avi|mkv|flv|m4v)$/);return m?.[1]||"mp4";}
async function initFFmpeg(){
  if(state.ffmpegReady)return;
  state.ffmpeg=createFFmpeg({log:false,corePath:"https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js",progress:({ratio})=>setProgress(Math.min(95,Math.round(ratio*100)))});
  state.ffmpeg.setLogger(({message})=>{const el=document.getElementById("ffLog");if(el){el.style.display="block";el.textContent=message;el.scrollTop=el.scrollHeight;}});
  await state.ffmpeg.load();state.ffmpegReady=true;
}
function switchTab(tab){
  state.currentTab=tab;
  document.getElementById("panel-upload").classList.toggle("hidden",tab!=="upload");
  document.getElementById("panel-url").classList.toggle("hidden",tab==="upload");
  document.getElementById("tab-upload").classList.toggle("active",tab==="upload");
  document.getElementById("tab-url").classList.toggle("active",tab!=="upload");
}
function handleFile(file){
  if(!file||!file.type.startsWith("video/")){alert("File bukan video!");return;}
  state.videoSource={type:"file",data:file};
  const tempUrl=URL.createObjectURL(file);
  const vid=document.createElement("video");
  vid.preload="metadata";
  vid.onloadedmetadata=()=>{
    const dur=Math.floor(vid.duration)||0;
    URL.revokeObjectURL(tempUrl);
    state.videoInfo={title:file.name,duration:dur,size:file.size};
    document.getElementById("vTitle").textContent=file.name;
    document.getElementById("vDurationTag").textContent="Durasi: "+(dur?fmtDur(dur):"Tidak diketahui");
    document.getElementById("vSizeTag").textContent="Ukuran: "+fmtSize(file.size);
    const dz=document.getElementById("dropzone");
    dz.classList.add("has-file");
    dz.querySelector(".dz-title").textContent="Terpilih: "+file.name;
    dz.querySelector(".dz-sub").textContent=fmtSize(file.size)+(dur?" | "+fmtDur(dur):"");
    show("sec-info");show("sec-settings");updateClipPreview();
  };
  vid.onerror=()=>{
    state.videoInfo={title:file.name,duration:0,size:file.size};
    document.getElementById("vTitle").textContent=file.name;
    document.getElementById("vDurationTag").textContent="Durasi: Tidak diketahui";
    document.getElementById("vSizeTag").textContent="Ukuran: "+fmtSize(file.size);
    show("sec-info");show("sec-settings");updateClipPreview();
    URL.revokeObjectURL(tempUrl);
  };
  vid.src=tempUrl;
}
function calcClips(){
  const mode=document.getElementById("clipMode").value;
  const dur=state.videoInfo?.duration||0;
  if(mode==="manual"){return state.manualSegments.map((s,i)=>{const st=timeToSec(s.start),en=timeToSec(s.end);return{index:i+1,start:st,end:en,duration:en-st};}).filter(c=>c.duration>0);}
  if(!dur)return[];
  let secs;
  if(mode==="duration"){const v=parseInt(document.getElementById("clipDuration").value)||30;secs=document.getElementById("durUnit").value==="m"?v*60:v;}
  else{secs=Math.ceil(dur/(parseInt(document.getElementById("clipCount").value)||3));}
  secs=Math.max(1,secs);
  const clips=[];let start=0,idx=1;
  while(start<dur){const end=Math.min(start+secs,dur);clips.push({index:idx++,start,end,duration:end-start});start=end;}
  return clips;
}
function updateClipPreview(){
  const clips=calcClips();
  const list=document.getElementById("clipList");
  if(!clips.length){list.innerHTML='<p class="muted-sm">Pilih video untuk melihat preview</p>';return;}
  list.innerHTML=clips.map(c=>`<div class="clip-item"><span class="clip-num">#${c.index}</span><span class="clip-time">${toHMS(c.start)} &rarr; ${toHMS(c.end)}</span><span class="clip-dur">${fmtDur(c.duration)}</span></div>`).join("");
}
async function processVideo(){
  const clips=calcClips();
  if(!clips.length){alert("Tidak ada klip. Periksa pengaturan.");return;}
  if(!state.videoSource){alert("Pilih video terlebih dahulu.");return;}
  show("sec-progress");hide("sec-results");hide("sec-error");
  setProgress(0);setProgText("Menginisialisasi FFmpeg (~20MB, sekali saja)...");
  try{
    await initFFmpeg();
    let videoData;
    if(state.videoSource.type==="file"){setProgText("Membaca file video...");videoData=await fetchFile(state.videoSource.data);}
    else{setProgText("Mengunduh video...");try{videoData=await fetchFile(state.videoSource.downloadUrl||state.videoSource.url);}catch(e){throw new Error("Gagal download: "+e.message);}}
    const ext=state.videoSource.type==="file"?getExt(state.videoSource.data.name):getExt(state.videoSource.downloadUrl||state.videoSource.url);
    const inFile=`input.${ext}`;
    const outFmt=document.getElementById("outFmt").value;
    state.ffmpeg.FS("writeFile",inFile,videoData);
    const results=[];
    for(let i=0;i<clips.length;i++){
      const c=clips[i];const outFile=`clip_${String(i+1).padStart(3,"0")}.${outFmt}`;
      setProgText(`Memotong bagian ${i+1} / ${clips.length}...`);setProgress(Math.round(5+(i/clips.length)*88));
      await state.ffmpeg.run("-ss",toHMS(c.start),"-i",inFile,"-t",String(Math.ceil(c.duration)),"-c","copy","-avoid_negative_ts","make_zero","-y",outFile);
      const data=state.ffmpeg.FS("readFile",outFile);
      const blob=new Blob([data.buffer],{type:`video/${outFmt}`});
      results.push({index:c.index,filename:outFile,blob,url:URL.createObjectURL(blob),size:data.length,start:c.start,end:c.end,duration:c.duration});
      state.ffmpeg.FS("unlink",outFile);
    }
    state.ffmpeg.FS("unlink",inFile);setProgress(100);state.processedClips=results;renderResults(results);
  }catch(err){showError(err.message);}
}
function renderResults(clips){
  document.getElementById("resSummary").textContent=`${clips.length} bagian berhasil!`;
  document.getElementById("resList").innerHTML=clips.map(c=>`<div class="result-item"><div class="result-top"><span class="result-title">Bagian ${c.index}</span><span class="result-meta">${toHMS(c.start)} &rarr; ${toHMS(c.end)} | ${fmtDur(c.duration)} | ${fmtSize(c.size)}</span></div><video class="result-video" controls src="${c.url}" preload="metadata"></video><div class="result-actions"><a href="${c.url}" download="${c.filename}" class="btn btn-primary btn-sm">Download ${c.filename}</a></div></div>`).join("");
  hide("sec-progress");show("sec-results");
}
async function downloadAllZip(){
  const btn=document.getElementById("dlAllBtn");btn.disabled=true;btn.textContent="Membuat ZIP...";
  try{
    const zip=new JSZip();
    const title=(state.videoInfo?.title||"video").replace(/[^\w\s-]/g,"").replace(/\s+/g,"_").slice(0,40)||"video";
    state.processedClips.forEach(c=>zip.file(c.filename,c.blob));
    const content=await zip.generateAsync({type:"blob",compression:"DEFLATE"});
    saveAs(content,`${title}_clips.zip`);
  }finally{btn.disabled=false;btn.innerHTML="Download Semua (ZIP)";}
}
function renderSegments(){
  document.getElementById("segList").innerHTML=state.manualSegments.map((seg,i)=>`<div class="seg-row"><span>Segmen ${i+1}</span><input type="text" value="${seg.start}" placeholder="00:00:00" class="time-input" onchange="state.manualSegments[${i}].start=this.value;updateClipPreview();" /><span>&rarr;</span><input type="text" value="${seg.end}" placeholder="00:00:00" class="time-input" onchange="state.manualSegments[${i}].end=this.value;updateClipPreview();" />${state.manualSegments.length>1?`<button class="btn btn-danger btn-sm" onclick="state.manualSegments.splice(${i},1);renderSegments();updateClipPreview();">X</button>`:""}</div>`).join("");
}
const show=id=>document.getElementById(id).classList.remove("hidden");
const hide=id=>document.getElementById(id).classList.add("hidden");
function setProgress(p){document.getElementById("progFill").style.width=`${p}%`;document.getElementById("progPct").textContent=`${p}%`;}
function setProgText(t){document.getElementById("progText").textContent=t;}
function showError(msg){document.getElementById("errMsg").textContent=msg;hide("sec-progress");show("sec-error");}
document.addEventListener("DOMContentLoaded",()=>{
  initFFmpeg().catch(()=>{});
  document.getElementById("fileInput").addEventListener("change",e=>{if(e.target.files[0])handleFile(e.target.files[0]);});
  const dz=document.getElementById("dropzone");
  dz.addEventListener("click",()=>document.getElementById("fileInput").click());
  dz.addEventListener("dragover",e=>{e.preventDefault();dz.classList.add("drag-over");});
  dz.addEventListener("dragleave",()=>dz.classList.remove("drag-over"));
  dz.addEventListener("drop",e=>{e.preventDefault();dz.classList.remove("drag-over");const f=e.dataTransfer.files[0];if(f)handleFile(f);});
  document.getElementById("fetchBtn").addEventListener("click",async()=>{
    const url=document.getElementById("videoUrl").value.trim();
    if(!url){alert("Masukkan URL.");return;}
    const btn=document.getElementById("fetchBtn");btn.disabled=true;btn.textContent="Mengambil...";
    try{
      const resp=await fetch("/.netlify/functions/get-video-info",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url})});
      if(!resp.ok){const e=await resp.json().catch(()=>({}));throw new Error(e.error||`HTTP ${resp.status}`);}
      const info=await resp.json();
      state.videoInfo=info;state.videoSource={type:"url",downloadUrl:info.downloadUrl,url};
      document.getElementById("vTitle").textContent=info.title||"Video";
      document.getElementById("vDurationTag").textContent="Durasi: "+(info.duration?fmtDur(info.duration):"-");
      document.getElementById("vSizeTag").textContent="Kualitas: "+(info.quality||"-");
      show("sec-info");show("sec-settings");hide("sec-error");updateClipPreview();
    }catch(e){alert("Error: "+e.message);}
    finally{btn.disabled=false;btn.textContent="Ambil Info";}
  });
  document.getElementById("videoUrl").addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("fetchBtn").click();});
  document.getElementById("clipMode").addEventListener("change",e=>{
    const m=e.target.value;
    document.getElementById("f-duration").classList.toggle("hidden",m!=="duration");
    document.getElementById("f-count").classList.toggle("hidden",m!=="count");
    document.getElementById("f-manual").classList.toggle("hidden",m!=="manual");
    if(m==="manual")renderSegments();updateClipPreview();
  });
  ["clipDuration","clipCount"].forEach(id=>document.getElementById(id).addEventListener("input",updateClipPreview));
  document.getElementById("durUnit").addEventListener("change",updateClipPreview);
  document.getElementById("addSegBtn").addEventListener("click",()=>{state.manualSegments.push({start:"00:00:00",end:"00:01:00"});renderSegments();updateClipPreview();});
  document.getElementById("processBtn").addEventListener("click",processVideo);
  document.getElementById("dlAllBtn").addEventListener("click",downloadAllZip);
  document.getElementById("newBtn").addEventListener("click",()=>location.reload());
  document.getElementById("retryBtn").addEventListener("click",()=>{hide("sec-error");show("sec-settings");});
});
