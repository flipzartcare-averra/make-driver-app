const express = require("express");
const { createRateLimiter } = require("../services/rateLimitStore");
const Booking = require("../models/Booking");
const { CAB_TYPES } = require("../data/cabTypes");

const router = express.Router();

// Booking creation is the write path that actually matters for revenue —
// limit it more gently than search, but still enough to blunt a retry-storm
// or scripted abuse from taking the DB down with everyone else.
const bookingLimiter = createRateLimiter({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const MOBILE_PATTERN = /^[+]?[0-9\s-]{7,15}$/;

router.post("/", bookingLimiter, async (req, res) => {
  const {
    tripType,
    customerName,
    mobileNumber,
    pickupAddress,
    from,
    to,
    date,
    cabTypeId,
    distanceKm,
    estimatedFare,
    deviceToken,
  } = req.body || {};

  if (!customerName || !mobileNumber || !pickupAddress || !from || !to || !date || !cabTypeId) {
    return res.status(400).json({
      error:
        "customerName, mobileNumber, pickupAddress, from, to, date and cabTypeId are required",
    });
  }
  if (!MOBILE_PATTERN.test(mobileNumber)) {
    return res.status(400).json({ error: "mobileNumber doesn't look like a valid phone number" });
  }
  if (!CAB_TYPES.some((c) => c.id === cabTypeId)) {
    return res.status(400).json({ error: `Unknown cabTypeId: ${cabTypeId}` });
  }

  try {
    const booking = await Booking.create({
      tripType,
      customerName,
      mobileNumber,
      pickupAddress,
      from,
      to,
      date,
      cabTypeId,
      distanceKm,
      estimatedFare,
      deviceToken, // optional — omitted entirely by web bookings, that's fine
    });
    res.status(201).json(booking);
  } catch (err) {
    res.status(503).json({ error: "Booking service unavailable, please retry" });
  }
});

// GET /api/bookings?mobileNumber=...&status=&page=&limit=
// mobileNumber is required here — without auth, letting this endpoint list
// every booking would hand out every customer's name, phone and pickup
// address to anyone who asks. A rider can look up their own bookings by
// the number they booked with; a full, unrestricted listing lives at
// GET /api/admin/bookings, behind admin login.
router.get("/", async (req, res) => {
  if (!req.query.mobileNumber) {
    return res.status(400).json({ error: "mobileNumber is required to look up bookings" });
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 20);
  const filter = { mobileNumber: req.query.mobileNumber }; // uses the {mobileNumber, createdAt} index
  if (req.query.status) filter.status = req.query.status;

  try {
    const [results, total] = await Promise.all([
      Booking.find(filter)
        .select("-deviceToken")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Booking.countDocuments(filter),
    ]);
    res.json({ results, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(503).json({ error: "Booking lookup unavailable" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).select("-deviceToken").lean();
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    res.json(booking);
  } catch (err) {
    res.status(400).json({ error: "Invalid booking id" });
  }
});

module.exports = router;
