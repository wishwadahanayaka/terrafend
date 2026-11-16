import ds from './ds.json'
import districtNames from './district-names.json'

// The DS division boundaries and the district names, as one file the app loads only when it has a
// landslide warning to draw (landslideShapes.ts, a dynamic import). Nothing else imports this, so the
// bundler keeps it, and ds.json with it, out of the main download.
export default { ds, districtNames }
