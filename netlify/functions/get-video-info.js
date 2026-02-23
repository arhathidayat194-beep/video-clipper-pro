exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { url } = JSON.parse(event.body || "{}");
    if (!url) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "URL diperlukan" }) };

    const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");

    // Kalau bukan YouTube, langsung pakai URL-nya
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

    // ── Ambil judul dari YouTube oEmbed (gratis, tanpa API key) ──
    let title = "YouTube Video";
    try {
      const oe = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (oe.ok) { const d = await oe.json(); title = d.title || title; }
    } catch (_) {}

    // ── Thumbnail dari YouTube CDN ──
    const vidMatch = url.match(/(?:v=|youtu\.be\/)([^&\n?#]{11})/);
    const vidId    = vidMatch?.[1] || "";
    const thumbnail = vidId ? `https://img.youtube.com/vi/${vidId}/hqdefault.jpg` : "";

    // ── Cobalt API untuk dapat URL download (handle bot detection) ──
    const cobaltRes = await fetch("https://api.cobalt.tools/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        url: url,
        videoQuality: "480",
        filenameStyle: "basic",
        downloadMode: "auto",
      }),
    });

    if (!cobaltRes.ok) throw new Error(`Cobalt API gagal: HTTP ${cobaltRes.status}`);

    const cobalt = await cobaltRes.json();

    if (cobalt.status === "error") {
      throw new Error(`Cobalt error: ${cobalt.error?.code || JSON.stringify(cobalt.error)}`);
    }

    const downloadUrl = cobalt.url;
    if (!downloadUrl) throw new Error("Tidak ada URL download. Coba link YouTube lain.");

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        title,
        duration: 0,
        thumbnail,
        downloadUrl,
        quality: "480p",
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
