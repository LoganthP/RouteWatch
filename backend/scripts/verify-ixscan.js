require('dotenv').config();
const mongoose = require('mongoose');
const Incident = require('../src/models/Incident');

async function checkIndex() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/routewatch_db');
  console.log('Collection:', Incident.collection.name);
  console.log('Total incidents:', await Incident.countDocuments());

  const polygon = {
    type: 'Polygon',
    coordinates: [[[76.5, 12.2], [76.8, 12.2], [76.8, 12.4], [76.5, 12.4], [76.5, 12.2]]]
  };
  const exp = await Incident.find({
    location: {
      $geoWithin: {
        $geometry: polygon
      }
    }
  }).explain('executionStats');

  console.log('Winning plan:', JSON.stringify(exp.queryPlanner?.winningPlan, null, 2));
  console.log('Execution stats:', JSON.stringify(exp.executionStats, null, 2));
  await mongoose.disconnect();
}
checkIndex().catch(console.error);
