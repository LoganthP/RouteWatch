const mongoose = require('mongoose');

// Model registry: one document per trained model version.
const mlModelSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true }, // 'severity-rf'
    version: { type: Number, required: true },
    algorithm: String,
    params: mongoose.Schema.Types.Mixed,
    metrics: mongoose.Schema.Types.Mixed,
    featureImportance: [{ feature: String, importance: Number, _id: false }],
    samples: { train: Number, test: Number },
    filters: mongoose.Schema.Types.Mixed,
    trainedBy: String,
    trainSeconds: Number,
  },
  { timestamps: true }
);
mlModelSchema.index({ kind: 1, version: -1 });

module.exports = mongoose.model('MlModel', mlModelSchema);
