/* ============================================================
   get-video-info.js — menggunakan Invidious API (open source)
   Tidak perlu API key, CORS-friendly, lebih stabil dari ytdl
   ============================================================ */

// Daftar instance Invidious publik (fallback ke berikutnya jika gagal)
const INSTANCES = [
  "https://inv.nadeko.net",
  "https://yt.cdaut.de",
  "https://invidious.privacydev.net",
  "https://iv.melmac.space",
  "https://invidious.nerdvpn.de",
];

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { url } = JSON.parse(event.body || "{}");
    if (!url) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "URL diperlukan" }) };

    const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");

    // ── Bukan YouTube → pakai langsung ──────────────────────────
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

    // ── Ekstrak video ID ─────────────────────────────────────────
    const match = url.match(/(?:v=|youtu\.be\/)([^&\n?#]{11})/);
    if (!match) throw new Error("Tidak bisa mengambil video ID dari URL YouTube ini");
    const videoId = match[1];

    // ── Coba tiap Invidious instance ─────────────────────────────
    let result = null;
    let lastErr = "";

    for (const instance of INSTANCES) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);

        const resp = await fetch(
          `${instance}/api/v1/videos/${videoId}?fields=title,lengthSeconds,formatStreams,videoThumbnails`,
          { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0" } }
        );
        clearTimeout(timer);

        if (!resp.ok) { lastErr = `${instance} → HTTP ${resp.status}`; continue; }

        const data = await resp.json();
        if (data.error) { lastErr = `${instance} → ${data.error}`; continue; }

        // formatStreams = video+audio muxed (itag 18=360p, 22=720p, dll)
        const formats = (data.formatStreams || []).filter(f => f.container === "mp4");
        if (!formats.length) { lastErr = `${instance} → Tidak ada format MP4`; continue; }

        // Pilih kualitas terbaik ≤ 480p agar cepat diproses FFmpeg.wasm
        const fmt = formats.find(f => f.qualityLabel === "360p")
                  || formats.find(f => f.qualityLabel === "480p")
                  || formats[0];

        // ⭐ Proxy melalui Invidious agar browser bisa download (CORS OK)
        const proxyUrl = `${instance}/latest_version?id=${videoId}&itag=${fmt.itag}&local=true`;

        const thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

        result = {
          title: data.title || "YouTube Video",
          duration: parseInt(data.lengthSeconds) || 0,
          thumbnail: thumb,
          downloadUrl: proxyUrl,
          quality: fmt.qualityLabel || "360p",
          instance: instance,
        };
        break; // berhasil → hentikan loop

      } catch (e) {
        lastErr = `${instance} → ${e.message}`;
        continue;
      }
    }

    if (!result) {
      throw new Error(`Semua server gagal. Coba lagi atau gunakan link MP4 langsung.\nDetail: ${lastErr}`);
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify(result),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: err.message || "Gagal memproses URL video" }),
    };
  }
};
