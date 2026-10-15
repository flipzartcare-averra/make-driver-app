const mongoose = require("mongoose");
const { Schema } = mongoose;

const CabTypeSchema = new Schema({
  id: { type: String, required: true, unique: true }, // e.g. "sedan"
  label: { type: String, required: true },
  example: { type: String, required: true },
  seats: { type: Number, required: true },
  baseKm: { type: Number, required: true },
  baseFare: { type: Number, required: true },
  perKm: { type: Number, required: true },
});

module.exports = mongoose.models.CabType || mongoose.model("CabType", CabTypeSchema);
