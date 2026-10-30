const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    _id: { type: String, default: 'global' },
    summary: { type: Object, default: null },
    trend: { type: Object, default: null },
    heat: { type: Array, default: [] },
    extent: { type: Object, default: null },
    hot: { type: Object, default: null },
    areas: { type: Array, default: [] },
    recent: { type: mongoose.Schema.Types.Mixed, default: { items: [], total: 0 } },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'dashboard_stats', minimize: false }
);

module.exports = mongoose.model('DashboardStats', schema);

