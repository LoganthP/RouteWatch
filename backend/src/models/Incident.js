const mongoose = require('mongoose');
const { INCIDENT_TYPES, SEVERITIES, STATUSES, SOURCES } = require('../config/constants');

// GeoJSON Point — coordinates are [longitude, latitude]
const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (c) => Array.isArray(c) && c.length === 2 &&
          c[0] >= -180 && c[0] <= 180 && c[1] >= -90 && c[1] <= 90,
        message: 'coordinates must be [longitude, latitude] within valid ranges',
      },
    },
  },
  { _id: false }
);

const incidentSchema = new mongoose.Schema(
  {
    incidentId: { type: String, unique: true },
    type: { type: String, enum: INCIDENT_TYPES, required: true },
    severity: { type: String, enum: SEVERITIES, required: true },
    status: { type: String, enum: STATUSES, default: 'Pending' },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    area: { type: String, trim: true, default: 'Unassigned' },
    location: { type: pointSchema, required: true },
    tz: { type: String, default: 'UTC' }, // IANA zone → local-time analytics anywhere in the world
    reportedAt: { type: Date, required: true, default: Date.now },
    resolvedAt: { type: Date },
    source: { type: String, enum: SOURCES, default: 'User Report' },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    datasetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dataset' },
    fingerprint: { type: String }, // dedupe key for imported rows
    isSynthetic: { type: Boolean, default: false },
    aiSeverity: { type: String, enum: SEVERITIES }, // model suggestion at report time
  },
  { timestamps: true }
);

incidentSchema.index({ location: '2dsphere' });
incidentSchema.index({ reportedAt: -1 });
incidentSchema.index({ severity: 1, status: 1 });
incidentSchema.index({ severity: 1, reportedAt: -1 });
incidentSchema.index({ type: 1, reportedAt: -1 });
incidentSchema.index({ area: 1, reportedAt: -1 });
incidentSchema.index({ datasetId: 1, reportedAt: -1 });
incidentSchema.index(
  { fingerprint: 1 },
  { unique: true, partialFilterExpression: { fingerprint: { $type: 'string' } } }
);

module.exports = mongoose.model('Incident', incidentSchema);
