const mongoose = require('mongoose');

// One uploaded file (or zip) and the import job that loads it.
const datasetSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    file: { name: String, size: Number, kind: String },
    sources: [{ name: String, kind: String, size: Number, _id: false }],
    filePath: { type: String, select: false },
    status: {
      type: String,
      enum: ['uploaded', 'importing', 'completed', 'failed', 'cancelled', 'stopped', 'deleting'],
      default: 'uploaded',
    },
    statusNote: String,
    preview: { type: mongoose.Schema.Types.Mixed, select: false },
    mapping: mongoose.Schema.Types.Mixed,
    scope: mongoose.Schema.Types.Mixed,
    progress: {
      rowsRead: { type: Number, default: 0 },
      imported: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      duplicates: { type: Number, default: 0 },
      geocoded: { type: Number, default: 0 },
      rate: { type: Number, default: 0 },
      phase: { type: String, default: 'reading' },
    },
    bbox: [Number], // [w, s, e, n]
    rejectedCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: String,
    startedAt: Date,
    finishedAt: Date,
  },
  { timestamps: true }
);

datasetSchema.index({ createdAt: -1 });
module.exports = mongoose.model('Dataset', datasetSchema);
