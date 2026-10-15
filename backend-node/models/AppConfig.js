const mongoose = require("mongoose");
const { Schema } = mongoose;

// A single document (there's only ever one) holding the current app
// version info. The Flutter app compares its own version against
// latestVersion/minSupportedVersion on launch to decide whether to show
// an "update available" nudge or a blocking "update required" screen.
const AppConfigSchema = new Schema(
  {
    key: { type: String, default: "app-config", unique: true },
    latestVersion: { type: String, default: "1.0.0" },
    minSupportedVersion: { type: String, default: "1.0.0" },
    updateMessage: {
      type: String,
      default: "A new version of Averra is available with fixes and improvements.",
    },
    androidStoreUrl: { type: String, default: "" },
    iosStoreUrl: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.AppConfig || mongoose.model("AppConfig", AppConfigSchema);
