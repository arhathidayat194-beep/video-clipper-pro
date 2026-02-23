const ytdl = require("@distube/ytdl-core");

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { url } = JSON.parse(event.body || "{}");
    if (!url) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "URL diperlukan" }) };

    const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");

    if (!isYouTube) {
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          title: decodeURIComponent(url.split("/").pop().split("?")[0]) || "Video",
          duration: 0,
          downloadUrl: url,
          quality: "Original",
          isDirectUrl: true,
        }),
      };
    }

    if (!ytdl.validateURL(url)) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "URL YouTube tidak valid" }) };
    }

    const info = await ytdl.getInfo(url, {
      requestOptions: { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } },
    });

    let formats = ytdl.filterFormats(info.formats, "videoandaudio");
    if (!formats.length) formats = info.formats.filter((f) => f.hasVideo && f.hasAudio);
    if (!formats.length) throw new Error("Tidak ada format video+audio yang tersedia");

    formats.sort((a, b) => (parseInt(a.qualityLabel) || 0) - (parseInt(b.qualityLabel) || 0));
    const format = formats.find((f) => parseInt(f.qualityLabel) <= 480) || formats[0];

    const thumbnails = info.videoDetails.thumbnails || [];
    const thumb = thumbnails[thumbnails.length - 1]?.url || "";

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        title: info.videoDetails.title,
        duration: parseInt(info.videoDetails.lengthSeconds),
        thumbnail: thumb,
        downloadUrl: format.url,
        quality: format.qualityLabel || "Auto",
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: err.message || "Gagal memproses URL video" }),
    };
  }
};
