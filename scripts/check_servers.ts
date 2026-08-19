import "dotenv/config";

async function main() {
  try {
    const resBackend = await fetch("http://127.0.0.1:5000/api/plans/active/campaign_1786718877499_3jk4zv");
    console.log("Backend Port 5000 API Status:", resBackend.status);
  } catch (e: any) {
    console.log("Backend Port 5000 error:", e.message);
  }

  try {
    const resExpo = await fetch("http://localhost:8081");
    console.log("Expo Port 8081 Status:", resExpo.status);
  } catch (e: any) {
    console.log("Expo Port 8081 error:", e.message);
  }
}

main().catch(console.error);
