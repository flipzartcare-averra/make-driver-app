const express = require("express");
const { getCabTypes, getCabTypeById } = require("../services/cabTypeCache");

const router = express.Router();

const JAVA_FARE_SERVICE_URL =
  process.env.JAVA_FARE_SERVICE_URL || "http://localhost:8080/api/fare/calculate";

function localEstimate(cab, distanceKm) {
  const extraKm = Math.max(0, distanceKm - cab.baseKm);
  const total = cab.baseFare + extraKm * cab.perKm;
  return { total: Math.round(total), source: "node-fallback" };
}

// POST /api/fare/estimate  { cabTypeId, distanceKm, tripType }
router.post("/estimate", async (req, res) => {
  const { cabTypeId, distanceKm, tripType } = req.body || {};

  if (!cabTypeId || typeof distanceKm !== "number") {
    return res.status(400).json({ error: "cabTypeId and numeric distanceKm are required" });
  }

  const cabTypes = await getCabTypes();
  const cab = getCabTypeById(cabTypes, cabTypeId);
  if (!cab) {
    return res.status(400).json({ error: `Unknown cabTypeId: ${cabTypeId}` });
  }

  try {
    // Java owns the pricing *rules* (round-trip/local multipliers, future
    // surge windows, toll tables). The actual rate numbers — base fare,
    // per-km, included km — are admin-editable in MongoDB, so they're sent
    // as overrides on every request rather than trusting Java's own
    // hardcoded defaults, which only exist as a fallback.
    const javaRes = await fetch(JAVA_FARE_SERVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cabTypeId,
        distanceKm,
        tripType,
        baseFare: cab.baseFare,
        perKm: cab.perKm,
        includedKm: cab.baseKm,
      }),
      signal: AbortSignal.timeout(3000),
    });

    if (!javaRes.ok) throw new Error(`Java service responded ${javaRes.status}`);

    const data = await javaRes.json();
    return res.json({ total: data.total, source: "java-fare-engine" });
  } catch (err) {
    // Fare engine unreachable — degrade gracefully instead of failing the
    // booking flow. Still uses the same admin-edited rate, just without
    // Java's trip-type multipliers.
    return res.json(localEstimate(cab, distanceKm));
  }
});

module.exports = router;
