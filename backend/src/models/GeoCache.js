const mongoose = require('mongoose');

// Cache of address → coordinates lookups (Nominatim), so each address is geocoded once.
const geoCacheSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  lng: Number,
  lat: Number,
  found: Boolean,
  createdAt: { type: Date, default: Date.now },
});
module.exports = mongoose.model('GeoCache', geoCacheSchema);
