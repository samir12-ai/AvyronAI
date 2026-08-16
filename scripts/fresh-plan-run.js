const http = require('http');

function makeRequest(path, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: method,
      headers: {
        'Accept': 'application/json',
        'Campaign-Id': 'campaign_1773576062201_6t0oxi'
      }
    };
    
    if (body) {
      options.headers['Content-Type'] = 'application/json';
    }
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        } catch(e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const campaignId = process.argv[2];
  if (!campaignId) {
    console.error("Usage: node scripts/fresh-plan-run.js <campaignId>");
    process.exit(1);
  }
  
  console.log("1. Logging in...");
  const loginRes = await makeRequest('/api/auth/login', 'POST', {
    email: 'dev@avyron.test',
    password: 'preview'
  });
  const token = loginRes.body.token;
  if (!token) throw new Error("Login failed: " + JSON.stringify(loginRes.body));

  console.log("\n2. Triggering Orchestrator (executionMode: PRODUCTION)...");
  const triggerRes = await makeRequest(`/api/orchestrator/run`, 'POST', {
    campaignId: campaignId,
    executionMode: 'PRODUCTION',
    forceRefresh: true
  }, token);
  
  console.log("TRIGGER status:", triggerRes.status);
  console.log("TRIGGER body:", triggerRes.body);
  
  if (triggerRes.status !== 200 || !triggerRes.body.jobId) {
    throw new Error("Failed to trigger orchestrator");
  }

  const jobId = triggerRes.body.jobId;
  console.log("\n3. Waiting for Orchestrator to complete (polling)...");

  let status = "RUNNING";
  let jobData = null;
  while (status === "RUNNING") {
    await sleep(3000);
    const progressRes = await makeRequest(`/api/orchestrator/status/${jobId}`, 'GET', null, token);
    
    status = progressRes.body.status;
    jobData = progressRes.body;
    console.log(`  Status: ${status} | Error: ${jobData.error} | Blocked: ${jobData.blockedEngines?.length}`);
  }

  console.log("\nORCHESTRATOR FINISHED");
  console.log("Status:", status);
  console.log("jobData:", JSON.stringify(jobData, null, 2));
  console.log("Engines Blocked:", jobData.blockedEngines?.length);

  // If completed, we should check active plan endpoint
  console.log("\n4. Checking Active Plan Endpoint...");
  const activePlanRes = await makeRequest(`/api/plans/active/${campaignId}`, 'GET', null, token);
  console.log("ENDPOINT: /api/plans/active/:campaignId");
  console.log("RETURNED runId:", activePlanRes.body.runId);
  console.log("RETURNED plan status:", activePlanRes.body.plan?.status);
  const newPlanId = activePlanRes.body.plan?.id;
  console.log("RETURNED planId:", newPlanId);
  console.log("RETURNED isStale:", activePlanRes.body.isStale);
  console.log("RETURNED isLatest:", activePlanRes.body.isLatest);

  if (activePlanRes.body.isStale || !newPlanId) {
    console.log("WARNING: Active plan is stale or missing!");
    process.exit(1);
  }

  console.log("\n5. Approving NEW Plan...");
  const approveRes = await makeRequest(`/api/plans/${newPlanId}/approve`, 'POST', { force: false }, token);
  console.log("ENDPOINT: /api/plans/:planId/approve");
  console.log("RETURNED status:", approveRes.status);
  console.log("RETURNED body:", JSON.stringify(approveRes.body, null, 2));
}

run().catch(console.error);
