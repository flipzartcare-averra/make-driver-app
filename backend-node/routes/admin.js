const express = require("express");
const Booking = require("../models/Booking");
const { requireAdmin } = require("../middleware/auth");
const { sendPushToToken } = require("../services/push");

const router = express.Router();

// Everything here requires a valid admin session.
router.use(requireAdmin);

const VALID_STATUSES = ["pending_confirmation", "confirmed", "cancelled", "completed"];

const STATUS_MESSAGES = {
  confirmed: (b) => `Your cab from ${b.from} to ${b.to} on ${b.date} is confirmed.`,
  cancelled: (b) => `Your booking from ${b.from} to ${b.to} on ${b.date} has been cancelled.`,
  completed: (b) => `Trip complete — thanks for riding with Averra!`,
  pending_confirmation: (b) => `Your booking from ${b.from} to ${b.to} is pending confirmation.`,
};

// GET /api/admin/bookings?status=&q=&page=&limit=
// Unlike the public GET /api/bookings (which requires a mobileNumber),
// this can list everything — that's the point of putting it behind auth.
router.get("/bookings", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 20);
  const filter = {};
  if (req.query.status) {
    filter.status = req.query.status;
  } else {
    // "All" means "everything active" — cancelled bookings clutter the
    // default view without being useful there; they're still one click
    // away via the Cancelled tab, which passes status=cancelled explicitly.
    filter.status = { $ne: "cancelled" };
  }

  // Free-text search across name/phone/route for the dispatcher's search box.
  if (req.query.q) {
    const q = String(req.query.q).trim();
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ customerName: rx }, { mobileNumber: rx }, { from: rx }, { to: rx }];
  }

  try {
    const [results, total] = await Promise.all([
      Booking.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Booking.countDocuments(filter),
    ]);
    res.json({ results, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(503).json({ error: "Booking lookup unavailable" });
  }
});

// PATCH /api/admin/bookings/:id/status  { status: "confirmed" }
router.patch("/bookings/:id/status", async (req, res) => {
  const { status } = req.body || {};
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
  }

  try {
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true }
    );
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    // Fire-and-forget: a push notification failing (no token, Firebase not
    // configured, expired token) should never fail the status update itself.
    sendPushToToken(booking.deviceToken, {
      title: "Averra",
      body: STATUS_MESSAGES[status](booking),
      data: { bookingId: booking._id.toString(), status },
    }).catch(() => {});

    res.json(booking);
  } catch (err) {
    res.status(400).json({ error: "Invalid booking id or update failed" });
  }
});

module.exports = router;
