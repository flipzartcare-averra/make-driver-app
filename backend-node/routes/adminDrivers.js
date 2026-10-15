const express = require("express");
const Driver = require("../models/Driver");
const Booking = require("../models/Booking");
const { requireAdmin } = require("../middleware/auth");
const { sendPushToToken } = require("../services/push");

const router = express.Router();
router.use(requireAdmin);

router.get("/", async (req, res) => {
  const filter = {};
  if (["pending", "approved", "rejected"].includes(req.query.status)) filter.accountStatus = req.query.status;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  try {
    const [drivers, total] = await Promise.all([
      Driver.find(filter).select("-passwordHash").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Driver.countDocuments(filter),
    ]);
    res.json({ drivers, total, page, limit });
  } catch (err) {
    res.status(503).json({ error: "Drivers unavailable" });
  }
});

// Must be declared before "/:id/status" patterns only matter for different paths.
router.get("/assignments/pending", async (req, res) => {
  try {
    const bookings = await Booking.find({ driverAssignmentStatus: "pending_admin_approval" })
      .populate("claimedByDriverId", "name email phone vehicleNumber onDuty")
      .sort({ updatedAt: -1 })
      .select("-deviceToken")
      .lean();
    res.json({ bookings });
  } catch (err) {
    res.status(503).json({ error: "Assignments unavailable" });
  }
});

router.patch("/assignments/:bookingId", async (req, res) => {
  const { approve } = req.body || {};
  if (typeof approve !== "boolean") return res.status(400).json({ error: "approve must be true or false" });
  try {
    const booking = await Booking.findById(req.params.bookingId);
    if (!booking || booking.driverAssignmentStatus !== "pending_admin_approval") {
      return res.status(409).json({ error: "No pending driver claim on this booking" });
    }
    if (approve) {
      booking.driverAssignmentStatus = "approved";
      if (booking.status === "pending_confirmation") booking.status = "confirmed";
      await booking.save();
      sendPushToToken(booking.deviceToken, {
        title: "Driver assigned",
        body: `A driver has been assigned for ${booking.from} → ${booking.to}.`,
        data: { bookingId: booking._id.toString() },
      });
    } else {
      booking.driverAssignmentStatus = "unclaimed"; // back in the pool
      booking.claimedByDriverId = undefined;
      await booking.save();
    }
    res.json({ id: booking._id, driverAssignmentStatus: booking.driverAssignmentStatus, status: booking.status });
  } catch (err) {
    res.status(400).json({ error: "Invalid booking" });
  }
});

router.patch("/:id/status", async (req, res) => {
  const { accountStatus } = req.body || {};
  if (!["pending", "approved", "rejected"].includes(accountStatus)) {
    return res.status(400).json({ error: "accountStatus must be pending, approved or rejected" });
  }
  try {
    const update = { accountStatus };
    if (accountStatus !== "approved") update.onDuty = false;
    const d = await Driver.findByIdAndUpdate(req.params.id, update, { new: true }).select("-passwordHash");
    if (!d) return res.status(404).json({ error: "Driver not found" });
    res.json(d);
  } catch (err) {
    res.status(400).json({ error: "Invalid driver" });
  }
});

module.exports = router;
