const cache = new Map();
const CACHE_DURATION_MS = 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const query = (url.searchParams.get("q") || "").trim();
  if (query.length < 2 || query.length > 200) {
    return res.status(400).json({ error: "Search query must be between 2 and 200 characters." });
  }

  const cacheKey = query.toLocaleLowerCase("ko");
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_DURATION_MS) {
    return res.status(200).json(cached.places);
  }

  try {
    const searchUrl = new URL("https://nominatim.openstreetmap.org/search");
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("format", "jsonv2");
    searchUrl.searchParams.set("limit", "5");
    searchUrl.searchParams.set("addressdetails", "1");
    searchUrl.searchParams.set("accept-language", "ko,en");

    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": `DistanceFinder/1.0 (Vercel deployment: ${req.headers.host || "local"})`,
        "Accept-Language": "ko,en",
      },
    });
    if (!response.ok) {
      return res.status(response.status === 429 ? 429 : 502)
        .json({ error: "Place search provider is unavailable." });
    }

    const results = await response.json();
    const places = results.map((place) => ({
      lat: place.lat,
      lon: place.lon,
      name: place.name || place.display_name.split(",")[0],
      display_name: place.display_name,
    }));
    cache.set(cacheKey, { createdAt: Date.now(), places });
    return res.status(200).json(places);
  } catch {
    return res.status(502).json({ error: "Place search provider is unavailable." });
  }
};
