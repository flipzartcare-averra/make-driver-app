const express = require("express");
const bcrypt = require("bcryptjs");
const Driver = require("../models/Driver");
const { createRateLimiter } = require("../services/rateLimitStore");
const { signDriverToken, requireDriver, revokeDriverToken } = require("../middleware/driverAuth");
const google = require("../services/googleAuth");

const router = express.Router();

const authLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});

function driverPublicShape(d) {
  return {
    id: d._id.toString(),
    name: d.name,
    email: d.email,
    phone: d.phone || "",
    vehicleNumber: d.vehicleNumber || "",
    accountStatus: d.accountStatus,
    onDuty: d.onDuty,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get("/config", (req, res) => res.json({ googleSignIn: google.isConfigured() }));

router.post("/signup", authLimiter, async (req, res) => {
  const { name, email, password, phone, vehicleNumber } = req.body || {};
  if (!name || !email || !password || !phone || !vehicleNumber) {
    return res.status(400).json({ error: "name, email, password, phone and vehicleNumber are required" });
  }
  if (!EMAIL_RE.test(String(email))) return res.status(400).json({ error: "Enter a valid email" });
  if (String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  try {
    const lower = String(email).trim().toLowerCase();
    if (await Driver.findOne({ email: lower })) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    const driver = await Driver.create({
      name: String(name).trim(),
      email: lower,
      passwordHash: await bcrypt.hash(String(password), 10),
      phone: String(phone).trim(),
      vehicleNumber: String(vehicleNumber).trim().toUpperCase(),
    });
    res.status(201).json({ token: signDriverToken(driver), driver: driverPublicShape(driver) });
  } catch (err) {
    res.status(503).json({ error: "Sign-up unavailable, please retry" });
  }
});

router.post("/login", authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });
  try {
    const driver = await Driver.findOne({ email: String(email).trim().toLowerCase() });
    const ok = driver && driver.passwordHash && (await bcrypt.compare(String(password), driver.passwordHash));
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });
    res.json({ token: signDriverToken(driver), driver: driverPublicShape(driver) });
  } catch (err) {
    res.status(503).json({ error: "Login unavailable, please retry" });
  }
});

router.post("/google", authLimiter, async (req, res) => {
  const { idToken, phone, vehicleNumber } = req.body || {};
  if (!idToken) return res.status(400).json({ error: "idToken is required" });
  if (!google.isConfigured()) return res.status(501).json({ error: "Google sign-in is not enabled on this server" });

  let info;
  try {
    info = await google.verifyGoogleIdToken(idToken);
  } catch (err) {
    return res.status(401).json({ error: "Google sign-in could not be verified" });
  }

  try {
    let driver = await Driver.findOne({ $or: [{ googleId: info.googleId }, { email: info.email }] });
    if (!driver) {
      // New Google drivers must supply phone + vehicle, same as email signup.
      if (!phone || !vehicleNumber) {
        return res.status(422).json({ error: "phone and vehicleNumber are required for new accounts", needsProfile: true });
      }
      driver = await Driver.create({
        name: info.name,
        email: info.email,
        googleId: info.googleId,
        phone: String(phone).trim(),
        vehicleNumber: String(vehicleNumber).trim().toUpperCase(),
      });
    } else if (!driver.googleId) {
      driver.googleId = info.googleId; // link existing email account
      await driver.save();
    }
    res.json({ token: signDriverToken(driver), driver: driverPublicShape(driver) });
  } catch (err) {
    res.status(503).json({ error: "Sign-in unavailable, please retry" });
  }
});

router.post("/logout", requireDriver, async (req, res) => {
  await revokeDriverToken(req.token);
  res.json({ status: "logged_out" });
});

router.get("/me", requireDriver, async (req, res) => {
  try {
    const d = await Driver.findById(req.driverId);
    if (!d) return res.status(401).json({ error: "Account no longer exists" });
    res.json(driverPublicShape(d));
  } catch (err) {
    res.status(503).json({ error: "Unavailable" });
  }
});

module.exports = router;
module.exports.driverPublicShape = driverPublicShape;
