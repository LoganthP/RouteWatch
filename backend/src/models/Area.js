const mongoose = require('mongoose');

// A named zone with a GeoJSON Polygon boundary.
const areaSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    kind: { type: String, enum: ['Locality', 'Corridor', 'District'], default: 'Locality' },
    center: { type: [Number], required: true }, // [lng, lat]
    boundary: {
      type: { type: String, enum: ['Polygon'], required: true, default: 'Polygon' },
      coordinates: { type: [[[Number]]], required: true },
    },
  },
  { timestamps: true }
);

areaSchema.index({ boundary: '2dsphere' });

module.exports = mongoose.model('Area', areaSchema);
