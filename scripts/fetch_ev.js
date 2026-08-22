const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_m7cPxRkaqN2W@ep-twilight-night-asou49te.c-4.eu-central-1.aws.neon.tech/neondb?sslmode=require' });
client.connect().then(() => {
  return client.query("SELECT uid, raw_content FROM audience_evidence WHERE uid IN ('EV-144', 'EV-244', 'EV-254', 'EV-94', 'EV-56', 'EV-22', 'EV-6', 'EV-93', 'EV-12')");
}).then(res => {
  console.log(JSON.stringify(res.rows, null, 2));
  client.end();
}).catch(err => {
  console.error(err);
  client.end();
});
