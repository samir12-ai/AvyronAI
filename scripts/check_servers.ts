async function main() {
  try {
    const res8808 = await fetch("http://127.0.0.1:8808/");
    console.log("Port 8808 HTTP status:", res8808.status);
  } catch (err: any) {
    console.log("Port 8808 error:", err.message);
  }

  try {
    const res8081 = await fetch("http://127.0.0.1:8081/");
    console.log("Port 8081 HTTP status:", res8081.status);
  } catch (err: any) {
    console.log("Port 8081 error:", err.message);
  }
}

main();
