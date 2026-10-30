const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema(
  {
    action: { type: String, required: true }, // CREATE | UPDATE | STATUS | DELETE
    incidentId: { type: String },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String },
    changes: { type: mongoose.Schema.Types.Mixed }, // flexible per-action payload
    note: { type: String, maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditSchema);
