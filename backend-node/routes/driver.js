const express = require("express");
const Driver = require("../models/Driver");
const Booking = require("../models/Booking");
const { requireDriver } = require("../middleware/driverAuth");

const router = express.Router();
router.use(requireDriver);

async function loadDriver(req, res) {
  const d = await Driver.findById(req.driverId);
  if (!d) {
    res.status(401).json({ error: "Account no longer exists" });
    return null;
  }
  return d;
}

// Toggle duty. Only admin-approved drivers may go on duty.
router.patch("/duty", async (req, res) => {
  const { onDuty } = req.body || {};
  if (typeof onDuty !== "boolean") return res.status(400).json({ error: "onDuty must be true or false" });
  try {
    const d = await loadDriver(req, res);
    if (!d) return;
    if (onDuty && d.accountStatus !== "approved") {
      return res.status(403).json({ error: "Your account must be approved by admin before you can go on duty" });
    }
    d.onDuty = onDuty;
    await d.save();
    res.json({ onDuty: d.onDuty, accountStatus: d.accountStatus });
  } catch (err) {
    res.status(503).json({ error: "Unavailable, please retry" });
  }
});

// Open trips. Deliberately omits customerName / mobileNumber / pickupAddress.
router.get("/available-bookings", async (req, res) => {
  try {
    const d = await loadDriver(req, res);
    if (!d) return;
    if (d.accountStatus !== "approved" || !d.onDuty) {
      return res.json({ bookings: [], reason: d.accountStatus !== "approved" ? "not_approved" : "off_duty" });
    }
    const bookings = await Booking.find({ status: "pending_confirmation", driverAssignmentStatus: "unclaimed" })
      .select("from to distanceKm estimatedFare cabTypeId tripType date createdAt")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ bookings });
  } catch (err) {
    res.status(503).json({ error: "Unavailable, please retry" });
  }
});

// "I'm ready to take this route" — atomic so two drivers can't both claim it.
router.post("/available-bookings/:id/claim", async (req, res) => {
  try {
    const d = await loadDriver(req, res);
    if (!d) return;
    if (d.accountStatus !== "approved" || !d.onDuty) {
      return res.status(403).json({ error: "You must be approved and on duty" });
    }
    const updated = await Booking.findOneAndUpdate(
      { _id: req.params.id, status: "pending_confirmation", driverAssignmentStatus: "unclaimed" },
      { driverAssignmentStatus: "pending_admin_approval", claimedByDriverId: d._id },
      { new: true }
    ).select("from to distanceKm estimatedFare date driverAssignmentStatus");
    if (!updated) return res.status(409).json({ error: "This trip was already taken or is no longer available" });
    res.json({ status: "pending_admin_approval", booking: updated });
  } catch (err) {
    res.status(400).json({ error: "Invalid booking" });
  }
});

// Claims awaiting admin decision (route + rate only) or rejected.
router.get("/my-claims", async (req, res) => {
  try {
    const bookings = await Booking.find({
      claimedByDriverId: req.driverId,
      driverAssignmentStatus: "pending_admin_approval",
    })
      .select("from to distanceKm estimatedFare cabTypeId tripType date driverAssignmentStatus createdAt")
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ bookings });
  } catch (err) {
    res.status(503).json({ error: "Unavailable, please retry" });
  }
});

// Full details (incl. customer mobile) only AFTER admin approved this claim.
router.get("/my-trips", async (req, res) => {
  try {
    const d = await loadDriver(req, res);
    if (!d) return;
    if (d.accountStatus !== "approved") return res.json({ bookings: [] });
    const bookings = await Booking.find({
      claimedByDriverId: d._id,
      driverAssignmentStatus: "approved",
    })
      .select("-deviceToken -razorpayOrderId -razorpayPaymentId")
      .sort({ date: -1 })
      .limit(100)
      .lean();
    res.json({ bookings });
  } catch (err) {
    res.status(503).json({ error: "Unavailable, please retry" });
  }
});

module.exports = router;
