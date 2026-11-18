function isCoordinate(value) {
  return value !== null
    && typeof value === "object"
    && Number.isFinite(value.lat)
    && Number.isFinite(value.lon)
    && value.lat >= -90
    && value.lat <= 90
    && value.lon >= -180
    && value.lon <= 180;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { start, destination } = req.body || {};
  if (!isCoordinate(start) || !isCoordinate(destination)) {
    return res.status(400).json({ error: "Valid start and destination coordinates are required." });
  }

  try {
    const coordinates = `${start.lon},${start.lat};${destination.lon},${destination.lat}`;
    const routeUrl = new URL(`https://router.project-osrm.org/route/v1/driving/${coordinates}`);
    routeUrl.searchParams.set("overview", "false");
    routeUrl.searchParams.set("steps", "false");
    const response = await fetch(routeUrl, {
      headers: { "User-Agent": `DistanceFinder/1.0 (Vercel deployment: ${req.headers.host || "local"})` },
    });

    if (!response.ok) {
      return res.status(502).json({ error: "Route provider is unavailable." });
    }
    const data = await response.json();
    if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
      return res.status(404).json({ error: "No drivable route was found." });
    }
    return res.status(200).json({ distance: data.routes[0].distance });
  } catch {
    return res.status(502).json({ error: "Route provider is unavailable." });
  }
};
