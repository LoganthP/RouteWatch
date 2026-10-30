const mongoose = require('mongoose');

const overviewSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'global' },
    summary: { type: mongoose.Schema.Types.Mixed, default: null },
    temporal: { type: mongoose.Schema.Types.Mixed, default: {} },
    areas: { type: Array, default: [] },
    severity: { type: Array, default: [] },
    bounds: { type: mongoose.Schema.Types.Mixed, default: null },
    hotspots: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'summary_overview', minimize: false }
);

const mapGridSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // 'grid_low', 'grid_mid'
    zoomBand: { type: String, required: true },
    cell: { type: Number, required: true },
    items: { type: Array, default: [] },
    total: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'summary_map_grid', minimize: false }
);

const SummaryOverview = mongoose.model('SummaryOverview', overviewSchema);
const SummaryMapGrid = mongoose.model('SummaryMapGrid', mapGridSchema);

module.exports = { SummaryOverview, SummaryMapGrid };

