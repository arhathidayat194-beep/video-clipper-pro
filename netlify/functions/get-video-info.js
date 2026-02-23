exports.handler = async (event) => {
  const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Content-Type":"application/json"};
  if (event.httpMethod==="OPTIONS") return {statusCode:200,headers:cors,body:""};
  if (event.httpMethod!=="POST") return {statusCode:405,headers:cors,body:JSON.stringify({error:"Method not allowed"})};
  try {
    const {url} = JSON.parse(event.body||"{}");
    if (!url) return {statusCode:400,headers:cors,body:JSON.stringify({error:"URL diperlukan"})};
    const isYT = url.includes("youtube.com")||url.includes("youtu.be");
    if (isYT) return {statusCode:400,headers:cors,body:JSON.stringify({error:"YouTube tidak didukung langsung. Download dulu via cobalt.tools lalu upload filenya."})};
    return {statusCode:200,headers:cors,body:JSON.stringify({title:decodeURIComponent(url.split("/").pop().split("?")[0])||"Video",duration:0,downloadUrl:url,quality:"Original",isDirectUrl:true})};
  } catch(err) {
    return {statusCode:500,headers:cors,body:JSON.stringify({error:err.message})};
  }
};
